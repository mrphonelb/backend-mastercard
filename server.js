require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ======================================================
   🌐 SECURE CORS SETUP
   ====================================================== */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com", // ✅ Live website
      "https://mrphone-backend.onrender.com", // ✅ Backend host
      "http://localhost:3000", // ✅ Local dev
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
    credentials: true,
  })
);

app.options("*", cors());
app.use(express.json());

/* ======================================================
   🧠 HEALTH CHECK
   ====================================================== */
app.get("/", (_, res) => {
  res.send("✅ MrPhone Backend Ready for Mastercard Hosted Checkout!");
});

const port = process.env.PORT || 3000;

/* ======================================================
   💳 INITIATE CHECKOUT
   ====================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", draftId, description, customer } = req.body;
  const orderId = draftId || `ORDER-${Date.now()}`;

  try {
    console.log(`🧾 Creating Mastercard session for order ${orderId}...`);

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
          id: orderId,
          amount,
          currency,
          description: description || `Order #${orderId} - Mr. Phone Lebanon`,
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
    console.log("✅ Mastercard session created:", sessionId);

    res.json({
      sessionId,
      orderId,
    });
  } catch (error) {
    console.error(
      "❌ INITIATE_CHECKOUT failed:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to create Mastercard session",
      details: error.response?.data || error.message,
    });
  }
});

/* ======================================================
   💳 DIRECT REDIRECT ROUTE (for popup)
   ====================================================== */
app.get("/checkout/pay/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const payUrl = `${process.env.HOST}checkout/pay/${sessionId}`;
  res.redirect(payUrl);
});

/* ======================================================
   💰 PAYMENT RESULT HANDLER
   ====================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    console.log(`🔍 Verifying payment for ${orderId}...`);

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

    const data = verify.data;
    const result = data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result for ${orderId}: ${result}`);

    if (result === "SUCCESS") {
      // ✅ Notify parent window, close payment tab
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
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    return res.send(`
      <script>
        window.opener.postMessage("FAILURE", "*");
        window.close();
      </script>
    `);
  }
});

/* ======================================================
   🚀 START SERVER
   ====================================================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
