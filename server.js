require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ======================================================
   🌐 CORS
   ====================================================== */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com",
      "https://mrphone-backend.onrender.com",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
  })
);
app.use(express.json());

const port = process.env.PORT || 10000;

app.get("/", (_, res) => res.send("✅ MrPhone Backend Ready"));

/* ======================================================
   💳 INITIATE CHECKOUT AFTER DAFTRA DRAFT CREATED
   ====================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { draftId, amount, currency = "USD", description, customer } = req.body;

  try {
    console.log(`🧾 Creating Mastercard session for draft ${draftId}...`);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        interaction: {
          operation: "PURCHASE",
          merchant: {
            name: "Mr. Phone Lebanon",
            url: "https://www.mrphonelb.com",
            logo:
              "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          },
          locale: "en_US",
          returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${draftId}`,
          displayControl: {
            billingAddress: "HIDE",
            shipping: "HIDE",
            customerEmail: "HIDE",
          },
        },
        order: {
          id: draftId,
          amount,
          currency,
          description: description || `Draft #${draftId} - MrPhone Lebanon`,
        },
        customer,
      },
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const sessionId = response.data.session.id;
    console.log("✅ Session created:", sessionId);

    res.json({ sessionId });
  } catch (err) {
    console.error("❌ INITIATE_CHECKOUT failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create Mastercard session" });
  }
});

/* ======================================================
   💰 PAYMENT RESULT HANDLER
   ====================================================== */
app.get("/payment-result/:draftId", async (req, res) => {
  const { draftId } = req.params;

  try {
    const verify = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${draftId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const result = verify.data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result for ${draftId}: ${result}`);

    if (result === "SUCCESS") {
  // ✅ Notify parent window (the checkout tab)
  return res.send(`
    <script>
      window.opener.postMessage("SUCCESS", "*");
      window.close();
    </script>
  `);
} else {
  return res.send(`
    <script>
      window.opener.postMessage("FAILURE", "*");
      window.close();
    </script>
  `);
}


app.listen(port, () =>
  console.log(`✅ Backend running on http://localhost:${port}`)
);
