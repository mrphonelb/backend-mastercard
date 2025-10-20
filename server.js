require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ======================================================
   🌐 CORS + HEALTH CHECK
   ====================================================== */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com",
      "https://mrphone-backend.onrender.com",
      "http://localhost:3000",
    ],
    methods: ["GET","POST","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization","APIKEY"],
  })
);
app.options("*", cors());
app.use(express.json());

app.get("/", (req, res) => res.status(200).send("✅ MrPhone Backend Ready"));

const port = process.env.PORT || 3000;

/* ======================================================
   💳 CREATE MASTERCA RD SESSION
   ====================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { draftId, amount, currency = "USD" } = req.body;

  if (!draftId) {
    return res.status(400).json({ error: "Missing draftId (invoice ID)" });
  }

  try {
    console.log(`🧾 Creating Mastercard session for invoice ${draftId}...`);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "CREATE_CHECKOUT_SESSION",
        interaction: {
          operation: "PURCHASE",
          returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${draftId}`,
          // Removed unsupported params (merchant.url, customerEmail etc.)
          merchant: {
            name: "Mr Phone Lebanon",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png"
          }
        },
        order: {
          id: draftId,
          amount: amount,
          currency: currency,
          description: `Invoice #${draftId} – MrPhone Lebanon`
        }
      },
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    const sessionId = response.data.session.id;
    console.log(`✅ Session created for invoice ${draftId}: ${sessionId}`);
    return res.json({ sessionId });
  } catch (err) {
    console.error("❌ CREATE_CHECKOUT_SESSION failed:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create session",
      details: err.response?.data || err.message
    });
  }
});

/* ======================================================
   💰 VERIFY PAYMENT RESULT
   ====================================================== */
app.get("/payment-result/:draftId", async (req, res) => {
  const { draftId } = req.params;

  try {
    const verify = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${draftId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD
        }
      }
    );

    const result = (verify.data.result || "").toUpperCase();
    console.log(`💬 Payment result for ${draftId}: ${result}`);

    if (result === "SUCCESS") {
      return res.send(`
        <script>
          window.opener.postMessage("SUCCESS-${draftId}", "*");
          window.close();
        </script>
      `);
    } else {
      return res.send(`
        <script>
          window.opener.postMessage("FAILURE-${draftId}", "*");
          window.close();
        </script>
      `);
    }
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    return res.send(`
      <script>
        window.opener.postMessage("FAILURE-${draftId}", "*");
        window.close();
      </script>
    `);
  }
});

/* ======================================================
   🚀 START SERVER
   ====================================================== */
app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Backend running on port ${port}`);
});
