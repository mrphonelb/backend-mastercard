require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra API key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   💳 Create Daftra Draft + Mastercard Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;

    if (!client_id || !total)
      return res.status(400).json({ error: "Missing client_id or total" });

    // ✅ 1. Create Daftra Draft Invoice First
    console.log(`🧾 Creating Daftra draft for client ${client_id} | $${total}`);
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: "Draft created before Mastercard payment"
      },
      InvoiceItem: items.length
        ? items
        : [
            {
              item: "Online Order Payment",
              description: "Initial draft before Mastercard checkout",
              unit_price: total,
              quantity: 1
            }
          ]
    };

    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      draftPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        },
        timeout: 15000
      }
    );

    const draft = draftRes.data;
    if (!draft.id) throw new Error("Failed to create Daftra draft");

    console.log(`✅ Daftra draft created: ${draft.id}`);

    // ✅ 2. Create Mastercard Session using draft.id
    console.log(`💰 Creating MPGS session for Draft #${draft.id}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: `DRAFT-${draft.id}`, // show draft id in gateway
        amount: Number(total),
        currency,
        description: `Mr Phone LB - Draft ${draft.id}`
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com"
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/DRAFT-${draft.id}/${client_id}`, // ✅ verify after success
        redirectMerchantUrl:
          "https://www.mrphonelb.com/client/contents/payment_error",
        retryAttemptCount: 2,
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE"
        }
      }
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    const data = response.data;
    console.log("✅ MPGS session created:", data.session?.id);

    return res.json({
      ok: true,
      draft_id: draft.id,
      session: data.session,
      successIndicator: data.successIndicator
    });
  } catch (err) {
    console.error("❌ Error creating draft + session:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Daftra draft or Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💳 Verify Payment, Confirm & Redirect
   ==================================================== */
app.get("/verify-payment/:orderId/:clientId", async (req, res) => {
  try {
    const { orderId, clientId } = req.params;
    const draftId = orderId.replace("DRAFT-", "");
    console.log(`🔍 Verifying payment for Draft ${draftId}`);

    const orderResp = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(
        orderId
      )}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    const orderData = orderResp.data;
    const result = orderData.result;
    const status = orderData.order?.status || orderData.status;
    const amount = orderData.order?.amount || orderData.amount;

    if (result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED")) {
      console.log(`✅ Payment success for Draft ${draftId}`);

      // ✅ Optionally update the draft note or status in Daftra
      await axios.put(
        `https://www.mrphonelb.com/api2/invoices/${draftId}`,
        {
          Invoice: {
            notes: `✅ Payment confirmed via Mastercard for draft ${draftId}`,
            draft: false
          }
        },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            apikey: DAFTRA_API_KEY
          },
          timeout: 15000
        }
      );

      return res.redirect(
        `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftId}`
      );
    }

    console.warn("❌ Payment failed:", { result, status });
    return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
  } catch (err) {
    console.error("❌ Verify error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
  }
});

/* ====================================================
   🧠 Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready — MPGS shows draft ID and links payment to Daftra draft.");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
