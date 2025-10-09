require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// ✅ Allow CORS from anywhere (fixes Safari iframe issues)
app.use(
  cors({
    origin: "*", // or "https://www.mrphonelb.com"
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// ✅ Parse JSON request bodies (this is essential for POST)
app.use(express.json());

const port = process.env.PORT || 3000;

/* ===========================================
   🧠 Health Check
   =========================================== */
app.get("/", (req, res) => {
  res.send("✅ Backend is running!");
});

/* ===========================================
   💳 INITIATE CHECKOUT (POST endpoint)
   =========================================== */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount, currency, draftId, description, customer } = req.body;

    // 🧾 Log what frontend sends
    console.log("Received checkout:", req.body);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        checkoutMode: "WEBSITE",
        interaction: {
          operation: "PURCHASE",
          locale: "en_US",
          merchant: {
            name: "Mr. Phone Lebanon",
            logo:
              "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
            url: "https://www.mrphonelb.com",
          },
          displayControl: {
            billingAddress: "HIDE",
            customerEmail: "HIDE",
            shipping: "HIDE",
          },
          returnUrl: `https://www.mrphonelb.com/client/contents/thankyou?order_id=${draftId}`,
          redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?order_id=${draftId}`,
        },
        order: {
          id: draftId,
          amount,
          currency,
          description: description || `Draft Order #${draftId}`,
        },
        customer: {
          email: customer?.email || "",
          firstName: customer?.firstName || "",
          lastName: customer?.lastName || "",
          mobilePhone: customer?.phone || "",
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

    // ✅ Return Mastercard session info
    res.json(response.data);
  } catch (err) {
    console.error("❌ Error initiating checkout:", err.message);
    res.status(500).json({ error: "Failed to initiate checkout", details: err.message });
  }
});


app.get("/retrieve-order/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const merchantId = process.env.MERCHANT_ID;
  const apiPassword = process.env.API_PASSWORD;

  try {
    const url = `https://creditlibanais-netcommerce.gateway.mastercard.com/api/rest/version/100/merchant/${merchantId}/order/${orderId}`;
    const auth = "Basic " + Buffer.from(`merchant.${merchantId}:${apiPassword}`).toString("base64");

    const response = await fetch(url, {
      headers: { Authorization: auth, "Content-Type": "application/json" },
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("❌ Retrieve failed:", data);
      return res.status(response.status).json({ error: data });
    }

    // ✅ All transactions
    const txs = Array.isArray(data.transaction) ? data.transaction : [];

    // ✅ Get the last *money-moving* transaction (PAYMENT, AUTHORIZATION, CAPTURE)
    const validTxs = txs.filter(t =>
      ["PAYMENT", "AUTHORIZATION", "CAPTURE"].includes(t.transaction?.type)
    );
    const tx = validTxs[validTxs.length - 1] || txs[txs.length - 1] || {};

    // ✅ Fallback: find any transaction whose gatewayCode indicates failure
    const failureTx = txs.reverse().find(t =>
      /(DECLINED|EXPIRED_CARD|TIMED_OUT|UNSPECIFIED_FAILURE|ACQUIRER_SYSTEM_ERROR)/i.test(
        t.response?.gatewayCode || ""
      )
    );

    // ✅ Prefer failureTx if it exists
    const finalTx = failureTx || tx;

    const gatewayCode = finalTx.response?.gatewayCode?.toUpperCase() || "UNKNOWN";
    const acquirerMessage = finalTx.response?.acquirerMessage || "No message";
    const txResult = finalTx.result?.toUpperCase() || "UNKNOWN";
    const cardBrand = finalTx.sourceOfFunds?.provided?.card?.brand || "Card";
    const cardNumber = finalTx.sourceOfFunds?.provided?.card?.number || "****";

    // ✅ Decision matrix
    const successCodes = ["APPROVED", "APPROVED_AUTO", "APPROVED_PENDING_SETTLEMENT"];
    const failCodes = [
      "DECLINED",
      "DECLINED_AVS",
      "DECLINED_CSC",
      "DECLINED_AVS_CSC",
      "EXPIRED_CARD",
      "TIMED_OUT",
      "UNSPECIFIED_FAILURE",
      "ACQUIRER_SYSTEM_ERROR",
      "AUTHENTICATION_FAILED",
      "INSUFFICIENT_FUNDS",
      "BLOCKED",
      "CANCELLED",
      "FAILED",
      "ERROR",
    ];

    let finalStatus = "FAILED";
    let finalResult = "FAILURE";

    if (txResult === "SUCCESS" && successCodes.includes(gatewayCode)) {
      finalStatus = "CAPTURED";
      finalResult = "SUCCESS";
    }

    if (failCodes.includes(gatewayCode) || txResult === "FAILURE") {
      finalStatus = "FAILED";
      finalResult = "FAILURE";
    }

    res.json({
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
      creationTime: data.creationTime,
      result: finalResult,
      status: finalStatus,
      gatewayCode,
      acquirerMessage,
      cardBrand,
      cardNumber,
    });
  } catch (err) {
    console.error("❌ Error retrieving order:", err);
    res.status(500).json({ error: "Retrieve failed", details: err.message });
  }
});



// ==============================================
// ✅ START SERVER
// ==============================================
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
