require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* 🌐 Allow Daftra and your domain */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com",
      "https://mrphone-backend.onrender.com",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("✅ MrPhone Backend Ready");
});


const port = process.env.PORT || 3000;

/* ======================================================
   💳 INITIATE CHECKOUT (USE SAME DAFTRA INVOICE ID)
   ====================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { draftId, amount, currency = "USD", customer } = req.body;
  if (!draftId) return res.status(400).json({ error: "Missing draftId (invoice ID)" });

  const orderId = draftId.toString(); // ✅ same as Daftra invoice
  console.log(`🧾 Creating Mastercard session for Daftra invoice ${orderId}...`);

  try {
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
          id: orderId, // ✅ EXACT Daftra invoice ID
          amount,
          currency,
          description: `Payment for Invoice #${orderId}`,
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
  } catch (err) {
    console.error("❌ INITIATE_CHECKOUT failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create Mastercard session" });
  }
});

/* ======================================================
   💰 PAYMENT RESULT HANDLER
   ====================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
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
    console.log(`💬 Payment result for invoice ${orderId}: ${result}`);

    if (result === "SUCCESS") {
      return res.send(`
        <script>
          window.opener.postMessage("PAYMENT_SUCCESS_${orderId}", "*");
          window.close();
        </script>
      `);
    } else {
      return res.send(`
        <script>
          window.opener.postMessage("PAYMENT_FAIL_${orderId}", "*");
          window.close();
        </script>
      `);
    }
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    return res.send(`
      <script>
        window.opener.postMessage("PAYMENT_FAIL_${orderId}", "*");
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
