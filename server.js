require('dotenv').config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// ✅ Test route
app.get("/", (req, res) => {
  res.send("Backend is running and ready for Mastercard Hosted Checkout!");
});

// ✅ Initiate Checkout Endpoint
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency, orderId, invoiceId, description } = req.body;

  try {
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
      logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
      url: "https://www.mrphonelb.com"
    },
    displayControl: {
      billingAddress: "HIDE",
      customerEmail: "HIDE",
      shipping: "HIDE"
    },
    returnUrl: `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`,
    redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/payment_error?invoice_id=${invoiceId}`,
    retryAttemptCount: 2
  
    theme: {
            style: "modern",           // Modern checkout theme
            colorScheme: "LIGHT",      // Light background
            primaryColor: "#d9498e",   // Pink main color (buttons, highlights)
            secondaryColor: "#000000", // Black secondary (for back button)
            buttonRadius: "6px"        // Optional: rounded buttons
          }
        },

  order: {
    id: orderId,
    amount: amount,
    currency: currency,
    description: description || `Order #${invoiceId} - Mr. Phone Lebanon`
  }
},
      {
        // ✅ Correct authentication format for Mastercard Gateway
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD
        },
        headers: {
          "Content-Type": "application/json"
        }
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
      details: error.response ? error.response.data : error.message
    });
  }
});

// ✅ Start the Express server
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
