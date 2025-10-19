require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ====================================================
   🌐 CORS CONFIG
   ==================================================== */
app.use(
  cors({
    origin: "*", // temporarily allow all origins for testing
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options(/.*/, cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

const port = process.env.PORT || 3000;

/* ====================================================
   🩺 HEALTH CHECK
   ==================================================== */
app.get("/", (_, res) => {
  res.send("✅ MrPhone Backend is running for Mastercard Hosted Checkout!");
});

/* ====================================================
   💳 INITIATE CHECKOUT (create Daftra draft + MPGS session)
   ==================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", customer } = req.body;
  const orderId = `ORDER-${Date.now()}`;

  try {
    console.log(`🧾 Creating Daftra draft for order ${orderId}`);

    // ✅ 1. Create draft invoice in Daftra
    const draft = await axios.post(
      "https://www.daftra.com/v2/api/entity/invoice",
      {
        draft: true,
        name: `Draft Invoice ${orderId}`,
        currency,
        status: "unpaid",
        items: [
          {
            name: "Online Order",
            price: amount,
            qty: 1,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const draftId = draft.data.id;
    console.log("✅ Daftra draft created:", draftId);

    // ✅ 2. Create Mastercard session
    console.log("💳 Initiating Mastercard session...");

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        interaction: {
          operation: "PAY",
          merchant: {
            name: "Mr. Phone Lebanon",
            url: "https://www.mrphonelb.com",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          },
          locale: "en_US",
          returnUrl: `https://mrphone-backend.onrender.com/payment-result/${draftId}`,
          displayControl: {
            billingAddress: "HIDE",
            shipping: "HIDE",
            customerEmail: "HIDE",
          },
        },
        order: {
          id: orderId,
          amount,
          currency,
          description: `Order #${orderId} - Mr. Phone Lebanon`,
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

    console.log("✅ Mastercard session created:", response.data.session.id);

    // ✅ Send back both IDs
    res.json({
      sessionId: response.data.session.id,
      successIndicator: response.data.successIndicator,
      draftId,
      orderId,
    });
  } catch (error) {
    console.error("❌ INITIATE_CHECKOUT failed:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      details: error.response?.data || error.message,
    });
  }
});

/* ====================================================
   💰 PAYMENT RESULT — Verify Payment & Mark Invoice Paid
   ==================================================== */
app.get("/payment-result/:draftId", async (req, res) => {
  const { draftId } = req.params;

  try {
    console.log(`🔍 Verifying payment for draft ${draftId}...`);

    // ✅ Check Mastercard transaction result
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
      // ✅ Mark draft as paid in Daftra
      await axios.put(
        `https://www.daftra.com/v2/api/entity/invoice/${draftId}`,
        { status: "paid", draft: false },
        {
          headers: {
            Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Daftra invoice marked as paid.");
      return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftId}`);
    } else {
      console.warn("❌ Payment failed or not completed.");
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${draftId}`);
    }
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${draftId}`);
  }
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
