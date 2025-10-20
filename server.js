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
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
  })
);
app.options("*", cors());
app.use(express.json());

const port = process.env.PORT || 3000;

/* ======================================================
   💳 INITIATE CHECKOUT — USE SAME DAFTRA INVOICE ID
   ====================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { draftId, amount, currency = "USD", description, customer } = req.body;
  const orderId = draftId?.toString() || `ORDER-${Date.now()}`;

  try {
    console.log(`🧾 Creating Mastercard session for Daftra invoice ${orderId}...`);

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
          returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${orderId}`,
          displayControl: {
            billingAddress: "HIDE",
            shipping: "HIDE",
            customerEmail: "HIDE",
          },
        },
        order: {
          id: orderId, // ✅ SAME AS DAFTRA INVOICE
          amount,
          currency,
          description: description || `Daftra Invoice #${orderId} - Mr. Phone Lebanon`,
        },
        customer: {
          firstName: customer?.firstName || "Guest",
          lastName: customer?.lastName || "Customer",
          email: customer?.email || "guest@mrphonelb.com",
          mobilePhone: customer?.phone || "00000000",
        },
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
    console.log(`✅ Mastercard session created for invoice ${orderId}: ${sessionId}`);
    res.json({ sessionId, orderId });
  } catch (error) {
    console.error("❌ INITIATE_CHECKOUT failed:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      details: error.response?.data || error.message,
    });
  }
});

/* ======================================================
   💳 REDIRECT TO PAYMENT PAGE (popup)
   ====================================================== */
app.get("/checkout/pay/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const payUrl = `${process.env.HOST}checkout/pay/${sessionId}`;
  res.redirect(payUrl);
});

/* ======================================================
   💰 PAYMENT RESULT HANDLER — POSTS SUCCESS/FAIL
   ====================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    console.log(`🔍 Verifying payment for Daftra invoice ${orderId}...`);

    const verify = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const result = verify.data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result for ${orderId}: ${result}`);

    if (result === "SUCCESS") {
      return res.send(`
        <script>
          window.opener.postMessage("SUCCESS-${orderId}", "*");
          window.close();
        </script>
      `);
    } else {
      return res.send(`
        <script>
          window.opener.postMessage("FAILURE-${orderId}", "*");
          window.close();
        </script>
      `);
    }
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    return res.send(`
      <script>
        window.opener.postMessage("FAILURE-${orderId}", "*");
        window.close();
      </script>
    `);
  }
});

/* ======================================================
   🚀 START SERVER
   ====================================================== */
app.listen(port, () => {
  console.log(`✅ Backend running on http://localhost:${port}`);
});
