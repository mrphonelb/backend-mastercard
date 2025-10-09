require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

// 🧠 Cache customer info for later Daftra invoice
const customerCache = new Map();

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
// ✅ INITIATE CHECKOUT
// ==============================================
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency, draftId, description, customer } = req.body;
  const orderId = draftId; // use Daftra draft ID as Mastercard orderId

  try {
    console.log("🧾 Incoming payment data:", req.body);

    // ✅ Save customer info for later Daftra use
    customerCache.set(orderId, customer);

    // ✅ Allowed fields only for Mastercard
    const safeCustomer = {
      email: customer?.email || "",
      firstName: customer?.firstName || "",
      lastName: customer?.lastName || "",
      mobilePhone: customer?.phone || "",
    };

    // ✅ Create Mastercard session
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
        customer: safeCustomer,
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
    console.error("❌ Error from Mastercard API:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to initiate checkout",
      details: error.response?.data || error.message,
    });
  }
});

// ==============================================
// ✅ RETRIEVE ORDER & CONVERT DAFTRA DRAFT
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

    // ✅ If payment succeeded → convert Daftra draft
    if (orderData.result === "SUCCESS" && orderData.status === "CAPTURED") {
      await convertDaftraDraftToPaid({
        orderId,
        amount: orderData.amount,
        currency: orderData.currency,
        cardType: orderData.sourceOfFunds?.provided?.card?.brand || "Card",
        customer: customerCache.get(orderId) || orderData.customer || {},
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
// ✅ MARK EXISTING DAFTRA DRAFT AS PAID (FINAL)
// ==============================================
async function convertDaftraDraftToPaid(order) {
  const draftId = order.orderId;
  const c = order.customer || {};
  console.log(`🧾 Marking Daftra Draft #${draftId} as Paid...`);

  try {
    // ✅ Build full shipping info text
    const shippingDetails = `
    Shipping Information:
    - Name: ${c.firstName || ""} ${c.lastName || ""}
    - Governorate: ${c.governorate || ""}
    - District: ${c.district || ""}
    - City: ${c.city || ""}
    - Email: ${c.email || ""}
    - Phone: ${c.phone || ""}
    `.trim();

    // ✅ POST update to Daftra (Daftra API uses POST for updates)
    const updateRes = await axios.post(
      `${process.env.DAFTRA_DOMAIN}/api2/invoices/${draftId}`,
      {
        Invoice: {
          draft: false, // ✅ mark as final invoice
          notes: `Paid online via Mastercard (${order.cardType || "Card"})\n\n${shippingDetails}`,
        },
        Payment: [
          {
            payment_method: "Credit/Debit Card",
            amount: parseFloat(order.amount),
            transaction_id: draftId,
            date: new Date().toISOString().slice(0, 19).replace("T", " "),
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          apikey: process.env.DAFTRA_API_KEY,
        },
      }
    );

    console.log("✅ Draft updated successfully:", updateRes.data);
    return updateRes.data;
  } catch (error) {
    console.error("❌ Error updating Daftra draft:", error.response?.data || error.message);
    return null;
  }
}


// ==============================================
// ✅ START SERVER
// ==============================================
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
