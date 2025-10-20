require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ================================================
   🌐 CORS CONFIG
   ================================================ */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com",
      "https://mrphone-backend.onrender.com",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
  })
);
app.options("*", cors());
app.use(express.json());

app.use((req, _, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

const port = process.env.PORT || 10000;

/* ================================================
   🩺 HEALTH CHECK
   ================================================ */
app.get("/", (_, res) => res.send("✅ MrPhone Backend Running - Mastercard Redirect Flow"));

/* ================================================
   💳 INITIATE CHECKOUT (redirect-based)
   ================================================ */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", draftId, description, customer } = req.body;
  const orderId = draftId || `ORDER-${Date.now()}`;

  try {
    console.log(`🧾 Creating Mastercard session for ${orderId}...`);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        interaction: {
          operation: "PURCHASE",
          merchant: {
            name: "Mr. Phone Lebanon",
            url: "https://www.mrphonelb.com",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png"
          },
          locale: "en_US",
          returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${orderId}`,
          displayControl: {
            billingAddress: "HIDE",
            shipping: "HIDE",
            customerEmail: "HIDE"
          }
        },
        order: {
          id: orderId,
          amount,
          currency,
          description: description || `Order #${orderId} - Mr Phone Lebanon`
        },
        customer: {
          firstName: customer?.firstName || "Guest",
          lastName: customer?.lastName || "Customer",
          email: customer?.email || "guest@mrphonelb.com",
          mobilePhone: customer?.phone || "00000000"
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
    console.log("✅ Session created:", sessionId);

    res.json({ sessionId, orderId });
  } catch (error) {
    console.error("❌ INITIATE_CHECKOUT failed:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create Mastercard session" });
  }
});

/* ================================================
   💰 PAYMENT RESULT
   ================================================ */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const verify = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    const result = verify.data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result for ${orderId}: ${result}`);

    if (result === "SUCCESS") {
      // ✅ Redirect back to checkout page to auto-click "Place Order"
      return res.redirect("https://www.mrphonelb.com/client/contents/checkout?paid=true");
    } else {
      return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
    }
  } catch (err) {
    console.error("❌ Payment verification failed:", err.message);
    return res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
  }
});

/* ================================================
   🚀 START SERVER
   ================================================ */
app.listen(port, () => console.log(`✅ Backend running on http://localhost:${port}`));
