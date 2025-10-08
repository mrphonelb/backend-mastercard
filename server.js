require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// ✅ Test route
app.get("/", (req, res) => {
  res.send("✅ Backend is running and ready for Mastercard Hosted Checkout!");
});

// ==============================================
// ✅ INITIATE CHECKOUT ENDPOINT
// ==============================================
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency, draftId, description, customer } = req.body;
  const orderId = draftId; // ✅ use draftId as Mastercard orderId

  try {
    console.log("🧾 Incoming payment data:", req.body);

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
          amount: amount,
          currency: currency,
          description: description || `Draft Order #${orderId} - Mr. Phone Lebanon`,
        },
        // ✅ Send customer info for later Daftra use
        customer: customer || {},
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

// ==============================================
// ✅ RETRIEVE ORDER & CREATE DAFTRA INVOICE
// ==============================================
app.get("/retrieve-order/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const response = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const orderData = response.data;
    console.log(`✅ Retrieved order ${orderId}:`, orderData);

    // ✅ Only proceed if payment was successful
    if (orderData.result === "SUCCESS" && orderData.status === "CAPTURED") {
      await createDaftraClientAndInvoice({
        orderId,
        amount: orderData.amount,
        currency: orderData.currency,
        cardType: orderData.sourceOfFunds?.provided?.card?.brand || "Card",
        customer: orderData.customer || {},
      });
    }

    res.json(orderData);
  } catch (error) {
    console.error("❌ Error retrieving order:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to retrieve order",
      details: error.response?.data || error.message,
    });
  }
});

// ==============================================
// ✅ CREATE CLIENT + INVOICE IN DAFTRA
// ==============================================
async function createDaftraClientAndInvoice(order) {
  const c = order.customer || {};
  console.log(`🧾 Creating Daftra Client & Invoice for Order ${order.orderId}...`);

  try {
    // ✅ Step 1: Create Daftra Client
    const clientRes = await axios.post(
      `${process.env.DAFTRA_DOMAIN}/api2/clients`,
      {
        Client: {
          first_name: c.firstName || "Online",
          last_name: c.lastName || "Customer",
          email: c.email || "noemail@mrphonelb.com",
          phone1: c.phone || "",
          address1: `${c.city || ""}, ${c.district || ""}, ${c.governorate || ""}`,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": process.env.DAFTRA_API_KEY,
        },
      }
    );

    const clientId = clientRes.data?.Client?.id;
    console.log(`✅ Created Daftra Client ID: ${clientId}`);

    // ✅ Step 2: Create Daftra Invoice
    const invoiceRes = await axios.post(
      `${process.env.DAFTRA_DOMAIN}/api2/invoices`,
      {
        Invoice: {
          name: `Online Payment Order #${order.orderId}`,
          draft: false,
          currency_code: order.currency || "USD",
          client_id: clientId,
          date: new Date().toISOString().split("T")[0],
          notes: `Paid online via Mastercard (${order.cardType || "Card"})`,
        },
        InvoiceItem: [
          {
            item: "Online Purchase",
            description: `Payment for Order #${order.orderId}`,
            unit_price: parseFloat(order.amount),
            quantity: 1,
          },
        ],
        Payment: [
          {
            payment_method: "Credit/Debit Card",
            amount: parseFloat(order.amount),
            transaction_id: order.orderId,
            date: new Date().toISOString().slice(0, 19).replace("T", " "),
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": process.env.DAFTRA_API_KEY,
        },
      }
    );

    console.log("✅ Daftra Invoice Created:", invoiceRes.data);
    return invoiceRes.data;
  } catch (error) {
    console.error("❌ Error creating Daftra client/invoice:", error.response?.data || error.message);
    return null;
  }
}

// ==============================================
// ✅ START SERVER
// ==============================================
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
