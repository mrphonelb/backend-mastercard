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

// ✅ Daftra OAuth Token (you can refresh it manually if expired)
const DAFTRA_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMjA3MzU4MzdkNjdiNWJjYmMzZGRjMTE4NjJiOThjNWE1ZTBkYzdkNWE3ODliNmE3NmI1MjY3MjZiZWU3M2RlYjA5ZWQ1MWRiNzBkZDdmMWQiLCJpYXQiOjE3NDQ2MjA5MjIuMjU4NzM5OSwiZXhwIjoxODM5MzE1MzgyLjI0NjM3Miwic3ViIjoiNDA2MzI3MSIsInNjb3BlcyI6W10sInByb3ZpZGVyIjoib3duZXIiLCJuYmYiOjE3NDQ1MzQ1ODIuMjU4NzU4MX0.QBCnITMq1eIcdr0jx3JkJxU3QzB-PGPCAF0bKLbDOUmQf_o_XGUoEkLTQen75aBM9faIteUrfCwxZ4I8h_LoB-eprQK4Qxg-pbTLOoEixv6WMKTGL_AwCVpuWFoPWbSKVRDb43yFqGoLHuKLBe9-3I2fIjlXguvGbODaECEeL-cJkab6-oqlidiH9dpB-hFqQv1Nsd3uQUxu6C5PJDFyI1si10xy80Hu3jlMX7OS2V8SkFhsq11l2xTgHDDsXf9z4spp3di7dUzoXgFPFoXlp47zGRvc8kNLkr8_Dz3omttPsm82mKZNsCwAatac6Fxw7PJlHjTaTmSukHx9YAd9Nuc6q_AZ_7y2YhvYBj1DhxeVLb-i2BlxXTTJYgjZhqgLvh--4Z5XZCiXv2tagSKggNhNIoKKDftsEDYY8_5fWddMOeRI085yuB5vyrNrnGmv4E8_9VQI43nGuUyVWOFp5EvfQSPB8Db0byG95aSl9ub2d2Akclt3aZ9fWgV3Agxu34x6EQ1YGBrwoHJ_0XvUOWhI3T4_N1lmQapnpVhAEfvyVKccS1jAFO18OvKN-depxYzNIkkbnrxZ9uEsRpsj44oJlSt8QYKKSDn1t9gObkRWLqdmltgayskP4F1Rm2OE-b3FagG_IeKUyua5SFtsi_EU4JP37Kz2yqJWF5yW4R0";

/* ====================================================
   💳 1. Create Mastercard Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency" });

    console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          url: "https://www.mrphonelb.com"
        },
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE",
          shipping: "HIDE"
        },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout"
      },
      order: {
        id: orderId,
        amount: amount,
        currency: currency,
        description: "Mr Phone Lebanon Online Purchase"
      }
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log("✅ Mastercard Session Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Mastercard Session Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🧾 2. Create Draft Invoice (OAuth Auth)
   ==================================================== */
app.post("/create-draft", async (req, res) => {
  try {
    const { client_id, items, total } = req.body;
    if (!client_id || !items || !total)
      return res.status(400).json({ error: "Missing client_id, items, or total" });

    const payload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: "USD",
        notes: "Online draft created from checkout",
      },
      InvoiceItem: items,
    };

    const response = await axios.post("https://www.mrphonelb.com/api2/invoices", payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${DAFTRA_TOKEN}`,
      },
      timeout: 15000,
    });

    console.log("✅ Draft Invoice Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Daftra Draft Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Daftra draft",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   💳 3. Payment Success → Mark Invoice Paid
   ==================================================== */
app.post("/payment-success", async (req, res) => {
  try {
    const { invoiceId, amount, transactionId } = req.body;
    if (!invoiceId || !amount || !transactionId)
      return res.status(400).json({ error: "Missing invoiceId, amount, or transactionId" });

    const fee = +(amount * 0.035).toFixed(2);
    const payload = {
      Invoice: {
        draft: false,
        payment_status: "paid",
        notes: "Auto-marked as paid after Mastercard payment success",
      },
      InvoiceItem: [
        {
          item: "Credit Card Fee",
          description: "3.5% Mastercard Payment Fee",
          unit_price: fee,
          quantity: 1,
        },
      ],
      Payment: [
        {
          payment_method: "Credit / Debit Card",
          amount,
          transaction_id: transactionId,
          date: new Date().toISOString().slice(0, 19).replace("T", " "),
        },
      ],
    };

    const response = await axios.post(
      `https://www.mrphonelb.com/api2/invoices/${invoiceId}`,
      payload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${DAFTRA_TOKEN}`,
        },
        timeout: 15000,
      }
    );

    console.log("✅ Invoice Marked Paid:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Payment Update Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to mark invoice paid",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   🧠 Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready: Mastercard + Daftra OAuth Integration Working.");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
