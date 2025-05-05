const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { createCanvas, loadImage, registerFont } = require('canvas');
const admin = require('firebase-admin');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use(cors()); // Enable CORS for all routes

// Connect to MongoDB with retry logic
const connectWithRetry = () => {
  mongoose
    .connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => {
      console.error("Error connecting to MongoDB:", err);
      setTimeout(connectWithRetry, 5000); // Retry after 5 seconds
    });
};
connectWithRetry();

// Define MongoDB model
const SampleModel = mongoose.model(
  "Card",
  new mongoose.Schema({
    name: { type: String, required: true },
    number: { type: String, required: true },
    imagePath: { type: String, required: true },
  })
);

// Initialize Firebase Admin
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

// Register fonts
registerFont(path.join(__dirname, "/NotoSansArabic-Bold.ttf"), { family: 'ArabicFont' });
registerFont(path.join(__dirname, "/GlacialIndifference-Bold.otf"), { family: 'EnglishFont' });

// Root route
app.get("/", async (req, res) => {
  res.send("Hello! 2 :)");
});

// Route to fetch guests list
app.get("/guests_list", async (req, res) => {
  try {
    const allSamples = await SampleModel.find().lean(); // Use lean for better performance
    res.json(allSamples);
  } catch (error) {
    console.error("Error fetching guests:", error);
    res.status(500).json({ status: "nok", message: "Failed to fetch guests list" });
  }
});

// Route to fill image
app.post("/fill-image", async (req, res) => {
  try {
    const { name, number, twoNames } = req.body;

    if (!name || !number) {
      return res.status(400).json({ status: "nok", message: "Name and number are required" });
    }

    // Load the template image
    const template = await loadImage(path.join(__dirname, "/template.jpg"));

    // Create a canvas
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');

    // Draw the template image onto the canvas
    ctx.drawImage(template, 0, 0, template.width, template.height);

    let englishText = false;
    const languageRegex = /^[a-zA-Z\säöüÄÖÜßàáâãäåçèéêëìíîïðñòóôõöøùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ\s]+$/;
    if (languageRegex.test(name)) {
      englishText = true;
    }

    // Set font properties
    ctx.font = englishText ? '26px EnglishFont' : '26px ArabicFont';
    ctx.fillStyle = '#7d5438';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw name on the image
    ctx.fillText(name, ((canvas.width / 2) - 50), (canvas.height / 2) - (twoNames ? 180 : -35));

    const editedImageBuffer = canvas.toBuffer();

    const fileName = `hedayat/${new Date().getTime()}_edited-image.jpg`;
    const file = storage.file(fileName);

    await file.save(editedImageBuffer, {
      metadata: {
        contentType: 'image/jpeg'
      }
    });

    // Set expiration date to 1 year from now
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Generate a signed download URL
    const [imageUrl] = await file.getSignedUrl({
      action: 'read',
      expires: expiresAt.toISOString()
    });

    // Save to MongoDB
    const newSample = new SampleModel({
      name,
      number,
      imagePath: imageUrl,
    });

    const savedRecord = await newSample.save();

    res.json({ card: savedRecord });
  } catch (err) {
    console.error("Error creating image:", err);
    res.status(500).json({ status: "nok", message: "Failed to create image" });
  }
});

// Route to delete a guest by ID
app.delete("/guests_list/:id", async (req, res) => {
  try {
    const sampleId = req.params.id;
    const deletedSample = await SampleModel.findByIdAndDelete(sampleId);

    if (!deletedSample) {
      return res.status(404).json({ status: "not found", message: "Record not found" });
    }

    res.json({
      status: "success",
      message: "Record deleted successfully",
      deletedSample,
    });
  } catch (error) {
    console.error("Error deleting guest:", error);
    res.status(500).json({ status: "nok", message: "Failed to delete guest" });
  }
});

// Route to serve image by guest ID
app.get("/get-image/:id", async (req, res) => {
  try {
    const guestId = req.params.id;
    const guest = await SampleModel.findById(guestId);

    if (!guest || !guest.imagePath) {
      return res.status(404).json({ status: "not found", message: "Guest or image not found" });
    }

    // Fetch the image from Firebase Storage using the signed URL
    const response = await axios.get(guest.imagePath, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // Set response headers
    res.set({
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="${guest.name}.jpg"`,
      "Access-Control-Allow-Origin": "*", // Ensure CORS is allowed
    });

    res.send(buffer);
  } catch (error) {
    console.error("Error fetching image:", error);
    res.status(500).json({ status: "nok", message: "Failed to fetch image" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});