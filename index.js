const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, registerFont } = require('canvas');
const admin = require('firebase-admin');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());

app.use(cors())

// const allowedOrigins = ["https://navidbelly.vercel.app", "*"];
// app.use(cors({
//   origin: function(origin, callback) {
//     if (!origin || allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   }
// }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

// Define a sample MongoDB model
const SampleModel = mongoose.model(
  "Card",
  new mongoose.Schema({
    name: { type: String, required: true },
    number: { type: String, required: true },
    imagePath: { type: String, required: true },
  })
);


const serviceAccount = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
  universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
};


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'gs://navid-963cf.appspot.com'
});

const storage = admin.storage().bucket();

registerFont(path.join(__dirname, "/NotoSansArabic-Bold.ttf"), { family: 'ArabicFont' });
registerFont(path.join(__dirname, "/GlacialIndifference-Bold.otf"), { family: 'EnglishFont' });

// Example route
app.get("/", async (req, res) => {
  res.send("Hello! 2 :)");
});


// Route to fetch guests list
app.get("/guests_list", async (req, res) => {
    try {
      // Query the database to retrieve all records
      const allSamples = await SampleModel.find();
  
      // Send the array of records as the response
      res.json(allSamples);
    } catch (error) {
      console.error("Error fetching samples:", error);
      res.status(500).send({ status: "nok", message: error.message });
    }
  });

// Route to fill image
app.post("/fill-image", async (req, res) => {
    try {
        const { name, number, twoNames } = req.body;

        // Load the template image
        const template = await loadImage(path.join(__dirname, "/template.jpg"));

        // Create a canvas
        const canvas = createCanvas(template.width, template.height);
        const ctx = canvas.getContext('2d');

        // Draw the template image onto the canvas
        ctx.drawImage(template, 0, 0, template.width, template.height);

        let englishText = false; // Default to false
        const languageRegex = /^[a-zA-Z\säöüÄÖÜßàáâãäåçèéêëìíîïðñòóôõöøùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ\s]+$/;
        
        // Check if the text is in English
        if (languageRegex.test(name)) {
          englishText = true;
        }

        // Set font properties for Arabic text
        ctx.font = englishText ? '26px EnglishFont' : '26px ArabicFont'; // Use the custom font here
        ctx.fillStyle = '#7d5438'; // Set your desired color here
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle'; // Ensure text is vertically centered

        // Draw Arabic name on the image
        ctx.fillText(name, ((canvas.width / 2) - 50), (canvas.height / 2) - (twoNames ? 180 : -35));

        const editedImageBuffer = canvas.toBuffer();
        

        const fileName = `hedayat/${new Date().getTime()}_edited-image.jpg`;
        const file = storage.file(fileName);

        await file.save(editedImageBuffer, {
          metadata: {
            contentType: 'image/jpeg' // Adjust according to your image type
          }
        });

        // Set expiration date to 1 year from now
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        
        // Generate a signed download URL for the image
        const imageUrl = await file.getSignedUrl({
            action: 'read',
            expires: expiresAt.toISOString() // Using dynamic expiration date
          });

        // Create a new document in the database to store the image URL
        const newSample = new SampleModel({
            name: name,
            number: number,
            imagePath: imageUrl[0], // Use the Firebase Storage URL
        });

        const savedRecord = await newSample.save();

        // Send success response with the image URL from Firebase Storage
        res.json({ card: savedRecord });


    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});


// Route to delete a sample by ID
app.delete("/guests_list/:id", async (req, res) => {
    const sampleId = req.params.id;
  
    try {
      // Find the record by ID and delete it
      const deletedSample = await SampleModel.findByIdAndDelete(sampleId);
  
      // If the record is not found, return 404
      if (!deletedSample) {
        return res
          .status(404)
          .json({ status: "not found", message: "Record not found" });
      }
  
      // Send a success response
      res.json({
        status: "success",
        message: "Record deleted successfully",
        deletedSample,
      });
    } catch (error) {
      console.error("Error deleting sample:", error);
      res.status(500).send({ status: "nok", message: error.message });
    }
  });
  


// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
