require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*", methods: ["GET","POST","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MERCHANT_ID = process.env.MERCHANT_ID || "TEST06263500";
const API_PASSWORD = process.env.API_PASSWORD;
const API_URL = process.env.HOST || "https://creditlibanais-netcommerce.gateway.mastercard.com/api/rest/version/72";

app.get("/", (_, res) => res.send("✅ MrPhone Backend is running!"));

app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount, currency, draftId, description } = req.body;
    console.log(`💰 Creating session for ${amount} ${currency} | Draft: ${draftId}`);

  const payload = {
  apiOperation: "CREATE_CHECKOUT_SESSION"
};


    const response = await axios.post(
      `${API_URL}/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    const session = response.data.session;
    if (!session?.id) {
      console.error("❌ No session ID:", response.data);
      return res.status(502).json({ error: "No sessionId", debug: response.data });
    }

    console.log("✅ Session created:", session.id);
    res.json({ sessionId: session.id, successIndicator: session.successIndicator });
  } catch (err) {
    console.error("❌ MPGS error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message
    });
  }
});



app.listen(PORT, () => console.log(`🚀 MrPhone Backend running on port ${PORT}`));
