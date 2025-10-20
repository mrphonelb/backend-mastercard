require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// CORS + JSON
app.use(cors({
  origin: [
    "https://www.mrphonelb.com",
    "https://mrphone-backend.onrender.com",
    "http://localhost:3000"
  ],
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","APIKEY"],
}));
app.options("*", cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("✅ MrPhone Backend Ready");
});

const port = process.env.PORT || 3000;


/* ====================================================
   💳 INITIATE CHECKOUT — Create Mastercard Session
   ==================================================== */
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
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
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

    console.log("✅ Mastercard session created:", response.data.session.id);

    res.json({
      sessionId: response.data.session.id,
      successIndicator: response.data.successIndicator,
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

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Backend running on port ${port}`);
});
