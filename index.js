const express = require("express")
const cors = require("cors")
const path = require("path")
const qr=require("qrcode")
require("dotenv").config();
const app = express();
const port = 8003;

const cookieParser = require("cookie-parser");

const {v4:uuidv4}=require("uuid")

const {setUser,getUser}=require("./services/auth.js")

const allowedOrigins = [
    'https://trimlink-frontend.vercel.app',
    'http://localhost:8003',
    'http://127.0.0.1:8003'
];

app.use(cors({
    origin: function (origin, callback) {
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        if (!origin) return callback(null, true);
        
        const cleanOrigin = origin.replace(/\/$/, "");
        const isAllowed = allowedOrigins.includes(cleanOrigin) || 
                          cleanOrigin.endsWith('.vercel.app');
                          
        if (isAllowed) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

const mongoose = require("mongoose")
mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
    .then(() => {
        console.log("mongodb altas connected")
    })
    .catch((error) => {
        console.log(error.message)
    })


const userSchema=new mongoose.Schema({
    name:{
        type:String,
        required: true,
    },
    email:{
        type:String,
        required:true,
        unique:true,
    },
    password:{
        type:String,
        required:true
    },
},{
    timestamps:true,
    
})

const User=mongoose.model('user',userSchema);

const shortUrlSchema = new mongoose.Schema({
    longUrl: {
        type: String,
        required: true
    },
    shortId: {
        type: String,
        required: true,
        unique: true,
    },
    clicks: {
        type: Number,
        default: 0
    },
    qrCode:{
        type:String
    },
    createdBy: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "user"

    }
}, {
    timestamps: true,
});

const Url = mongoose.model("url", shortUrlSchema)

const { nanoid } = require("nanoid");

//app.use(express.json());

async function restrictToLoggedInUserOnly(req, res, next) {

    const userUid = req.cookies.uid;

    if (!userUid) {

        return res.status(401).json({

            message: "Please login first"

        });

    }

    const user = getUser(userUid);

    if (!user) {

        return res.status(401).json({

            message: "Invalid session"

        });

    }

    req.user = user;

    next();

}


app.post("/api/auth/signup", async (req,res)=>{
    try{
        const {name,email,password}=req.body;
        const trimmedName = name?.trim();
        const trimmedEmail = email?.trim().toLowerCase();
        if(!trimmedName||!trimmedEmail||!password){
            return res.status(400).json({
                message: "Name, email and password are required",
            })
        }

        const existUser=await User.findOne({email: trimmedEmail});
        if(existUser){
            return res.status(400).json({
                message:"User already exists with this email"
            })
        }
        
       const newUser= await User.create({
        name: trimmedName,
        email: trimmedEmail,
        password,
       })
       return res.status(201).json({
        message:"signup successfully",
        user: {
            _id: newUser._id,
            name: newUser.name,
            email: newUser.email,
        },
       })

    }catch (error){
        return res.status(500).json({

            message:error.message,
        })
    }
})

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email,password });

        if (!user) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const sessionId=uuidv4();
        setUser(sessionId,user);
        const isProd = process.env.NODE_ENV === 'production';
        res.cookie("uid", sessionId, {
            httpOnly: true,
            sameSite: isProd ? "none" : "lax",
            secure: isProd,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        return res.status(200).json({
            message:"login successfully",
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
            },
        });
        
    } catch (error) {
        return res.status(500).json({
            message: error.message
        });
    }
});

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("uid");
    return res.status(200).json({
        message: "logged out successfully"
    });
});

app.post("/api/",restrictToLoggedInUserOnly, async (req, res) => {

    try { 
        const { longUrl } = req.body
        if (!longUrl) {
            return res.status(400).json({
                message: "long url is required"
            })
        }
       
        const shortId = nanoid(5);
        const host = req.headers.host || 'localhost:8003';
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const backendUrl = host.includes('localhost') ? 'http://localhost:8003' : `${protocol}://${host}`;
        const shortUrl = `${backendUrl}/api/${shortId}`;
        const qrCode = await qr.toDataURL(shortUrl);
        
        const url = await Url.create({
            longUrl: longUrl,
            shortId: shortId,
            qrCode: qrCode,
            createdBy: req.user._id,
        });
        return res.status(201).json({
            message: "shortUrl generated ",
            shortId: `${shortId}`,
            shortUrl: `${backendUrl}/api/${shortId}`,
            qrCode: qrCode
        })
    } catch (error) {
        return res.status(500).json({ message: error.message })
    }

})



app.post("/api/custom/",restrictToLoggedInUserOnly,async(req,res)=>{
    try{
        const {longUrl,customId}=req.body

        if(!longUrl||!customId){
            return res.status(400).json({
                message:"longUrl and CustomId is required"
            })
        }
        const existId=await Url.findOne({
            shortId:customId
        })
        if(existId){
            return res.status(409).json({
                message:"Custom ID already exists"
            })
        }
        const host = req.headers.host || 'localhost:8003';
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const backendUrl = host.includes('localhost') ? 'http://localhost:8003' : `${protocol}://${host}`;
        const shortUrl = `${backendUrl}/api/${customId}`;
        const qrCode = await qr.toDataURL(shortUrl);

        const custom = await Url.create({
            longUrl: longUrl,
            shortId: customId,
            qrCode: qrCode,
            createdBy: req.user._id,
        })
        return res.status(201).json({
            message: "Custom Id Created Sucsessfully ",
            shortId: `${customId}`,
            shortUrl: `${backendUrl}/api/${customId}`,
            qrCode: qrCode
        })
    }catch(error){
        return res.status(500).json({
            message:error.message
        })
    }
})

app.get("/api/allUrls",restrictToLoggedInUserOnly, async (req, res) => {
    try {

        const page=parseInt(req.query.page) || 1;
        const limit=parseInt(req.query.limit) || 20;

        const skip=(page-1)*limit

        const allData = await Url.find({
            createdBy:req.user._id
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)

            const total= await Url.countDocuments({
                createdBy:req.user._id,
            });

        return res.status(200).json({
            total,
            page,
            totalPages:Math.ceil(total/limit),
            allData
        });
    } catch (error) {
        return res.status(500).json({ message: "Server Error", error });
    }

})


app.get("/api/:shortId", async (req, res) => {
    const shortUrl = await Url.findOne({
        shortId: { $regex: new RegExp("^" + req.params.shortId + "$", "i") }
    });

    if (!shortUrl) {
        return res.status(404).json({
            message: "this is not a working url"
        });
    }
    shortUrl.clicks++;
    await shortUrl.save();
    return res.status(200).redirect(shortUrl.longUrl);
});

app.get("/api/check/:shortId", async (req, res) => {
    const match = await Url.findOne({
        shortId: { $regex: new RegExp("^" + req.params.shortId + "$", "i") }
    });
    if (!match) {
        return res.status(404).json({
            message: "NOT VALID"
        });
    } else {
        return res.status(200).json({
            message: "VALID",
            shortId: match.shortId
        });
    }
});

app.get("/api/analytics/:shortId", restrictToLoggedInUserOnly, async (req, res) => {
    const shortUrl = await Url.findOne({
        shortId: { $regex: new RegExp("^" + req.params.shortId + "$", "i") },
        createdBy: req.user._id
    });
    if (!shortUrl) {
        return res.status(404).json({
            message: "this id is not valid"
        });
    }

    return res.status(200).json({
        totalClicks: shortUrl.clicks,
        createdAt: shortUrl.createdAt,
        updatedAt: shortUrl.updatedAt,
        qrCode: shortUrl.qrCode
    });
});

app.put("/api/shortUrl/Update/:shortId", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const { shortId, longUrl } = req.body;

        const existId = await Url.findOne({
            shortId: { $regex: new RegExp("^" + shortId + "$", "i") },
            createdBy: req.user._id
        });

        if (existId && shortId.toLowerCase() !== req.params.shortId.toLowerCase()) {
            return res.status(409).json({
                message: "This Short ID is already in use. Please choose a different one."
            });
        }

        const match = await Url.findOneAndUpdate(
            { shortId: { $regex: new RegExp("^" + req.params.shortId + "$", "i") } },
            { shortId: shortId, longUrl: longUrl },
            { new: true }
        );

        if (!match) {
            return res.status(404).json({
                message: "short id not found"
            });
        }

        return res.status(200).json({
            message: "update successfully"
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
});

app.delete("/api/shortUrl/Delete/:shortId", async (req, res) => {
    try {
        const match = await Url.findOneAndDelete({
            shortId: { $regex: new RegExp("^" + req.params.shortId + "$", "i") }
        });
        if (!match) {
            return res.status(404).json({
                message: "short id not found"
            });
        }
        return res.status(200).json({
            message: "short id delete successfully"
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message
        })
    }

})


app.use(express.static(path.join(__dirname, "../frontend")));

if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
        console.log("server is running on port", port)
        console.log("open http://localhost:8003/login.html")
    })
}

module.exports = app;

