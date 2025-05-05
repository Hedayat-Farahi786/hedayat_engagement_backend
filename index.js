const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { createCanvas, loadImage, registerFont } = require('canvas');
const admin = require('firebase-admin');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use(cors());

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
      setTimeout(connectWithRetry, 5000);
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
    const allSamples = await SampleModel.find().lean();
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

    const template = await loadImage(path.join(__dirname, "/template.jpg"));
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(template, 0, 0, template.width, template.height);

    let englishText = false;
    const languageRegex = /^[a-zA-Z\säöüÄÖÜßàáâãäåçèéêëìíîïðñòóôõöøùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ\s]+$/;
    if (languageRegex.test(name)) {
      englishText = true;
    }

    ctx.font = englishText ? '26px EnglishFont' : '26px ArabicFont';
    ctx.fillStyle = '#7d5438';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, ((canvas.width / 2) - 50), (canvas.height / 2) - (twoNames ? 180 : -35));

    const editedImageBuffer = canvas.toBuffer();
    const fileName = `hedayat/${new Date().getTime()}_edited-image.jpg`;
    const file = storage.file(fileName);

    await file.save(editedImageBuffer, {
      metadata: {
        contentType: 'image/jpeg'
      }
    });

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const [imageUrl] = await file.getSignedUrl({
      action: 'read',
      expires: expiresAt.toISOString()
    });

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
    console.log(`Fetching image for guest ID: ${guestId}`);

    // Validate guest ID
    if (!mongoose.Types.ObjectId.isValid(guestId)) {
      console.error(`Invalid guest ID: ${guestId}`);
      return res.status(400).json({ status: "nok", message: "Invalid guest ID" });
    }

    // Fetch guest from MongoDB
    const guest = await SampleModel.findById(guestId).lean();
    if (!guest || !guest.imagePath) {
      console.error(`Guest not found or no image path for ID: ${guestId}`);
      return res.status(404).json({ status: "not found", message: "Guest or image not found" });
    }

    console.log(`Image path: ${guest.imagePath}`);

    // Fetch image from Firebase Storage
    const response = await axios.get(guest.imagePath, { responseType: 'arraybuffer' });
    if (response.status !== 200) {
      console.error(`Failed to fetch image from Firebase: ${response.status}`);
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = Buffer.from(response.data);

    // Encode filename for Content-Disposition header
    const encodedFilename = encodeURIComponent(guest.name);
    const asciiFilename = guest.name.replace(/[^\x20-\x7E]/g, '_'); // Fallback for older browsers
    const contentDisposition = `attachment; filename="${asciiFilename}.jpg"; filename*=UTF-8''${encodedFilename}.jpg`;

    // Set response headers
    res.set({
      "Content-Type": "image/jpeg",
      "Content-Disposition": contentDisposition,
      "Access-Control-Allow-Origin": "*",
    });

    console.log(`Successfully fetched image for ${guest.name}`);
    res.send(buffer);
  } catch (error) {
    console.error(`Error in /get-image/${req.params.id}:`, error.message, error.stack);
    res.status(500).json({ status: "nok", message: `Failed to fetch image: ${error.message}` });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});