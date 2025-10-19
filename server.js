require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

const port = process.env.PORT || 3000;

// ✅ Health Check
app.get("/", (_, res) => res.send("✅ MrPhone Backend running for Mastercard Checkout"));

// ✅ Create Daftra Draft + Mastercard Session
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", customer } = req.body;
  const draftName = `Draft-${Date.now()}`;

  try {
    console.log("🧾 Creating Daftra draft invoice...");

    // 1️⃣ Create Daftra draft invoice
    const daftraDraft = await axios.post(
      "https://www.daftra.com/v2/api/entity/invoice",
      {
        draft: true,
        name: draftName,
        currency,
        status: "draft",
        items: [{ name: "Online Order", price: amount, qty: 1 }],
        client: customer?.firstName || "Guest",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const draftId = daftraDraft.data.id;
    console.log("✅ Draft invoice created:", draftId);

    // 2️⃣ Create Mastercard session using draft ID
    console.log("💳 Creating Mastercard checkout session...");

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "CREATE_CHECKOUT_SESSION", // ✅ Updated
        interaction: {
          operation: "PURCHASE",
          merchant: {
            name: "Mr. Phone Lebanon",
            url: "https://www.mrphonelb.com",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          },
          locale: "en_US",
          returnUrl: `https://mrphone-backend.onrender.com/payment-result/${draftId}`,
          displayControl: { billingAddress: "HIDE", shipping: "HIDE", customerEmail: "HIDE" },
        },
        order: {
          id: draftId,
          amount,
          currency,
          description: `Draft Invoice #${draftId}`,
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

    res.json({
      sessionId: response.data.session.id,
      successIndicator: response.data.successIndicator,
      draftId,
    });
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Payment Result
app.get("/payment-result/:draftId", async (req, res) => {
  const { draftId } = req.params;
  console.log("🔍 Verifying payment for invoice:", draftId);

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

    const result = verify.data.result?.toUpperCase();
    console.log("💬 Mastercard result:", result);

    if (result === "SUCCESS") {
      // ✅ Mark invoice as paid
      await axios.put(
        `https://www.daftra.com/v2/api/entity/invoice/${draftId}`,
        { draft: false, status: "paid" },
        {
          headers: {
            Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Invoice marked as paid:", draftId);
      return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftId}`);
    } else {
      console.warn("❌ Payment failed:", result);
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${draftId}`);
    }
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${draftId}`);
  }
});

app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
