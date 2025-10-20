require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*", methods: ["GET","POST","OPTIONS"] }));
app.use(express.json());

// (optional) cleaner logs
app.use((req, res, next) => {
  if (req.url === "/" && req.method === "GET") return next();
  const origin = req.headers.origin || "undefined";
  console.log(`➡️  ${req.method} ${req.url} | From Origin: ${origin}`);
  next();
});

const PORT = process.env.PORT || 10000;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const API_URL = process.env.API_URL; // .../api/rest/version/72

app.get("/", (_, res) => res.send("✅ MrPhone Backend OK"));

app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount, currency, draftId, description, customer } = req.body;

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout",
        merchant: {
          name: "Mr. Phone LB",
          logo: "https://www.mrphonelb.com/images/logo.png"
        }
      },
      order: {
        id: `ORDER-${draftId}`,
        amount: Number(amount).toFixed(2),
        currency: currency || "USD",
        description: description || `MrPhone order ${draftId}`
      },
      customer: {
        firstName: customer?.firstName || "Guest",
        lastName:  customer?.lastName  || "Customer",
        email:     customer?.email     || "guest@mrphonelb.com",
        mobilePhone: customer?.phone   || "0000"
      }
    };

    const mp = await axios.post(
      `${API_URL}/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    const { session } = mp.data || {};
    if (!session?.id) {
      return res.status(502).json({ error: "No session id from gateway", debug: mp.data });
    }
    res.json({ sessionId: session.id, successIndicator: session.successIndicator });
  } catch (e) {
    console.error("❌ MPGS error:", e.response?.data || e.message);
    res.status(500).json({ error: "Failed to create session", debug: e.response?.data || e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 MrPhone Backend on ${PORT}`));
