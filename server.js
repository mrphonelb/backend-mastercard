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

// ✅ Mastercard Retrieve Order
app.get("/retrieve-order/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const merchantId = process.env.MERCHANT_ID; // e.g. "TEST06263500"
  const password = process.env.MERCHANT_PASSWORD; // your API password

  try {
    const response = await fetch(
      `https://creditlibanais-netcommerce.gateway.mastercard.com/api/rest/version/100/merchant/${merchantId}/order/${orderId}`,
      {
        method: "GET",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`merchant.${merchantId}:${password}`).toString("base64"),
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Retrieve order failed:", data);
      return res.status(response.status).json({ error: data });
    }

    // ✅ Extract key info
    const orderResult = {
      id: data.id,
      amount: data.amount,
      currency: data.currency,
      result: data.result,
      status: data.status,
      creationTime: data.creationTime,
      sourceOfFunds: data.sourceOfFunds,
      transaction: data.transaction || [],
    };

    // 🧠 Add shorthand info from latest transaction
    const tx = data.transaction?.slice(-1)[0];
    if (tx) {
      orderResult.gatewayCode = tx.response?.gatewayCode;
      orderResult.acquirerMessage = tx.response?.acquirerMessage;
      orderResult.transactionResult = tx.result;
    }

    res.json(orderResult);
  } catch (error) {
    console.error("❌ Error retrieving order:", error);
    res.status(500).json({ error: "Retrieve failed", details: error.message });
  }
});


// ==============================================
// ✅ START SERVER
// ==============================================
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
