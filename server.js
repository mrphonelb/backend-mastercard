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
// ✅ INITIATE CHECKOUT
// ==============================================
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency, draftId, description, customer } = req.body;
  const orderId = draftId; // use Daftra draft ID as Mastercard orderId

  try {
    console.log("🧾 Incoming payment data:", req.body);

    // ✅ Only include allowed fields for Mastercard
    const safeCustomer = {
      email: customer?.email || "",
      firstName: customer?.firstName || "",
      lastName: customer?.lastName || "",
      phone: {
        number: customer?.phone || "",
      },
    };

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
        customer: safeCustomer, // ✅ only send safe fields
        // 💾 keep full shipping info for Daftra later
        metadata: {
          shipping: {
            governorate: customer?.governorate || "",
            district: customer?.district || "",
            city: customer?.city || "",
            email: customer?.email || "",
            phone: customer?.phone || "",
          },
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
    console.error("❌ Error from Mastercard API:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to initiate checkout",
      details: error.response?.data || error.message,
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

    // ✅ If payment succeeded, convert Daftra draft into paid invoice
    if (orderData.result === "SUCCESS" && orderData.status === "CAPTURED") {
      await createDaftraInvoiceFromDraft({
        orderId,
        amount: orderData.amount,
        currency: orderData.currency,
        cardType: orderData.sourceOfFunds?.provided?.card?.brand || "Card",
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
// ✅ CREATE FINAL INVOICE IN DAFTRA FROM DRAFT
// ==============================================
async function createDaftraInvoiceFromDraft(order) {
  const draftId = order.orderId;
  console.log(`🧾 Converting Draft #${draftId} into Paid Invoice...`);

  try {
    // ✅ Get draft details (includes client & shipping info)
    const draftRes = await axios.get(`${process.env.DAFTRA_DOMAIN}/api2/invoices/${draftId}`, {
      headers: {
        "Accept": "application/json",
        "apikey": process.env.DAFTRA_API_KEY,
      },
    });

    const draft = draftRes.data?.Invoice;
    if (!draft) {
      console.error("❌ Could not fetch draft invoice from Daftra");
      return;
    }

    const clientId = draft.client_id;
    if (!clientId) {
      console.error("❌ Draft invoice missing client_id");
      return;
    }

    // ✅ Extract shipping info from the draft (if available)
    const {
      client_first_name,
      client_last_name,
      client_email,
      client_phone,
      client_address1,
      client_city,
      client_state,
    } = draft;

    // ✅ Build shipping summary text
    const shippingSummary = `
      Shipping Information:
      Name: ${client_first_name || ""} ${client_last_name || ""}
      Governorate: ${client_state || ""}
      City: ${client_city || ""}
      Address: ${client_address1 || ""}
      Phone: ${client_phone || ""}
      Email: ${client_email || ""}
    `.trim();

    // ✅ Create new paid invoice
    const invoiceRes = await axios.post(
      `${process.env.DAFTRA_DOMAIN}/api2/invoices`,
      {
        Invoice: {
          name: `Online Payment for Draft #${draftId}`,
          draft: false,
          client_id: clientId,
          currency_code: order.currency || "USD",
          date: new Date().toISOString().split("T")[0],
          notes: `Paid online via Mastercard (${order.cardType || "Card"})\n\n${shippingSummary}`,
        },
        InvoiceItem: [
          {
            item: "Online Purchase",
            description: `Payment for Draft #${draftId}`,
            unit_price: parseFloat(order.amount),
            quantity: 1,
          },
        ],
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
          "Accept": "application/json",
          "apikey": process.env.DAFTRA_API_KEY,
        },
      }
    );

    console.log("✅ Final Daftra Invoice Created:", invoiceRes.data);
    return invoiceRes.data;
  } catch (error) {
    console.error("❌ Error creating Daftra invoice:", error.response?.data || error.message);
    return null;
  }
}

// ==============================================
// ✅ START SERVER
// ==============================================
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
