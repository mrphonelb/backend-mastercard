require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra API Key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   🧠 3) Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send(
    "✅ MrPhone Backend Ready — MPGS → Daftra draft → payment → finalize invoice (no fee in Daftra)."
  );
});

app.listen(PORT, () =>
  console.log(`✅ MrPhone backend running on port ${PORT}`)
);
