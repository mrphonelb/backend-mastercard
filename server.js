require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// ==============================================
// ✅ HEALTH CHECK
// ==============================================
app.get("/", (req, res) => {
  res.send("✅ Backend is running and ready for Mastercard Hosted Checkout!");
});

// ==============================================
// ✅ INITIATE CHECKOUT (Simplified Final Version)
// ==============================================
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency, draftId, description, customer } = req.body;
  const orderId = draftId; // use Daftra draft ID as Mastercard order ID

  try {
    console.log("🧾 Incoming payment data:", req.body);

    // ✅ Build request to Mastercard API
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
          returnUrl: `https://www.mrphonelb.com/client/contents/thankyou?order_id=${orderId}`,
          redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?order_id=${orderId}`,
          retryAttemptCount: 2,
        },
        order: {
          id: orderId,
          amount,
          currency,
          description: description || `Draft Order #${orderId} - Mr. Phone Lebanon`,
        },
        // ✅ Optional customer info (non-sensitive)
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

    console.log("✅ Response from Mastercard:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error(
      "❌ Error from Mastercard API:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      error: "Failed to initiate checkout",
      details: error.response ? error.response.data : error.message,
    });
  }
});

// ✅ Mastercard Retrieve Order — FINAL version
app.get("/retrieve-order/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const merchantId = process.env.MERCHANT_ID;       // e.g. "TEST06263500"
  const password = process.env.MERCHANT_PASSWORD;   // Your API password

  try {
    const url = `https://creditlibanais-netcommerce.gateway.mastercard.com/api/rest/version/100/merchant/${merchantId}/order/${orderId}`;
    const authHeader = "Basic " + Buffer.from(`merchant.${merchantId}:${password}`).toString("base64");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Retrieve failed:", data);
      return res.status(response.status).json({ error: data });
    }

    // ✅ Get latest transaction (last item)
    const tx = data.transaction?.slice(-1)[0];
    const gatewayCode = tx?.response?.gatewayCode || "";
    const acquirerMessage = tx?.response?.acquirerMessage || "";
    const txResult = tx?.result?.toUpperCase?.() || "";
    const orderResult = data.result?.toUpperCase?.() || "";
    const orderStatus = data.status?.toUpperCase?.() || "";

    // ✅ Define which codes mean success
    const approvedCodes = ["APPROVED", "APPROVED_AUTO", "APPROVED_PENDING_SETTLEMENT"];

    const isSuccessful =
      (orderResult === "SUCCESS" || txResult === "SUCCESS") &&
      approvedCodes.includes(gatewayCode);

    // ✅ Normalize response
    const normalized = {
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
      creationTime: data.creationTime,
      merchant: data.merchant,
      sourceOfFunds: data.sourceOfFunds,
      result: isSuccessful ? "SUCCESS" : "FAILURE",
      status: isSuccessful ? "CAPTURED" : "FAILED",
      gatewayCode: gatewayCode || "UNKNOWN",
      acquirerMessage: acquirerMessage || "No message from acquirer",
      transactionResult: txResult,
    };

    console.log("✅ Normalized order result:", normalized);
    res.json(normalized);
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
