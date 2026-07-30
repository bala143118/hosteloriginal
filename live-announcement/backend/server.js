require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');

const announcementRoutes = require('./routes/announcements');

const {
    sendTelegramMessage,
    sendFireAlert,
    sendMaintenanceAlert,
    sendSecurityAlert,
    sendCustomAlert
} = require('./telegram');


const app = express();

const server = http.createServer(app);


// Socket.IO

const io = require('socket.io')(server, {

    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }

});



// Configuration

const PORT = process.env.PORT || 6000;

const MONGODB_URI =
process.env.MONGODB_URI ||
"mongodb://localhost:27017/hostelfix-announcements";




// ==========================
// Middleware
// ==========================

app.use(cors());


app.use(express.json({
    limit:"10mb"
}));


app.use(express.urlencoded({
    extended:true,
    limit:"10mb"
}));




// Send socket to routes

app.use((req,res,next)=>{

    req.io = io;

    next();

});




// ==========================
// Announcement Routes
// ==========================

app.use(
    "/api/announcements",
    announcementRoutes
);




// ==========================
// Home Page
// ==========================

app.get("/",(req,res)=>{

    res.sendFile(
        path.join(__dirname,"index.html")
    );

});





// =================================================
// 🔥 FIRE ALERT API
// =================================================

app.post("/api/fire-alert", async(req,res)=>{


    try{


        const location =
        req.body.location || "Unknown Location";



        await sendFireAlert(location);



        io.emit(
            "fire-alert",
            {

                type:"fire",

                message:"Fire detected",

                location:location,

                time:new Date()

            }
        );



        res.json({

            success:true,

            message:"Fire alert sent successfully"

        });



    }

    catch(error){


        console.log(error);


        res.status(500).json({

            success:false,

            message:"Fire alert failed"

        });


    }


});







// =================================================
// 🚨 GENERAL ALERT API
// =================================================

app.post("/api/send-alert", async(req,res)=>{


    try{


        const {

            title,

            message,

            type


        } = req.body;




        await sendCustomAlert(

            title || "HOSTELFIX ALERT",

            message || "No message"

        );




        io.emit(
            "new-alert",
            {

                title,

                message,

                type,

                time:new Date()

            }
        );



        res.json({

            success:true,

            message:"Alert forwarded successfully"

        });



    }

    catch(error){


        console.log(error);


        res.status(500).json({

            success:false

        });


    }


});









// =================================================
// 🔧 MAINTENANCE ALERT API
// =================================================

app.post("/api/maintenance-alert", async(req,res)=>{


    try{


        const {

            room,

            issue


        } = req.body;



        await sendMaintenanceAlert(
            room,
            issue
        );



        io.emit(
            "maintenance-alert",
            {

                room,

                issue,

                time:new Date()

            }
        );



        res.json({

            success:true,

            message:"Maintenance alert sent"

        });



    }

    catch(error){


        console.log(error);


        res.status(500).json({

            success:false

        });


    }


});









// =================================================
// 🔐 SECURITY ALERT API
// =================================================

app.post("/api/security-alert", async(req,res)=>{


    try{


        const {

            event


        } = req.body;



        await sendSecurityAlert(event);



        io.emit(
            "security-alert",
            {

                event,

                time:new Date()

            }
        );



        res.json({

            success:true,

            message:"Security alert sent"

        });



    }

    catch(error){


        console.log(error);


        res.status(500).json({

            success:false

        });


    }


});









// =================================================
// SERVER ERROR HANDLER
// =================================================

app.use((err,req,res,next)=>{


    console.log(err);


    res.status(500).json({

        error:"Internal Server Error"

    });


});









// =================================================
// MongoDB + Server Start
// =================================================


mongoose.connect(MONGODB_URI)

.then(()=>{


    console.log("MongoDB connected");


    server.listen(PORT,()=>{


        console.log(
        `HostelFix Backend Running: http://localhost:${PORT}`
        );


    });


})


.catch((error)=>{


    console.log(
        "MongoDB Connection Failed:",
        error
    );


});









// =================================================
// Socket Connection
// =================================================


io.on("connection",(socket)=>{


    console.log(
        "Client connected:",
        socket.id
    );



    socket.on(
        "disconnect",
        ()=>{


            console.log(
                "Client disconnected:",
                socket.id
            );


        }
    );


});