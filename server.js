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
  const { amount, currency, orderId, invoiceId } = req.body;

  try {
    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        checkoutMode: "WEBSITE",
        interaction: {
          operation: "PURCHASE",
          merchant: {
            name: "Mr. Phone",
            url: "https://www.mrphonelb.com"
          },
          returnUrl: `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`
        },
        order: {
          amount: amount,
          currency: currency,
          id: orderId,
          description: description || `Order #${invoiceId} - Mr. Phone
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
