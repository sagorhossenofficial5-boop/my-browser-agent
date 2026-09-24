import express from 'express';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = 4000;
let generatedOTP = null;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'sagorhossen.official5@gmail.com',
    pass: 'dalavoomejmkikpz'
  }
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Test Signup App</title></head>
    <body style="font-family: Arial; padding: 40px; text-align: center;">
      <h2>Create Your Account</h2>
      <form action="/signup" method="POST">
        <input type="email" name="email" id="email" placeholder="Email Address" required style="padding: 10px; width: 250px;"><br><br>
        <input type="password" name="password" id="password" placeholder="Password" required style="padding: 10px; width: 250px;"><br><br>
        <button type="submit" id="submit-btn" style="padding: 10px 25px; background: #007bff; color: white; border: none; cursor: pointer;">Sign Up</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { email } = req.body;
  generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
  console.log(`\n[TEST-APP] Generated OTP: ${generatedOTP} for ${email}`);

  try {
    const info = await transporter.sendMail({
      from: '"Automation Agent" <sagorhossen.official5@gmail.com>',
      to: 'sagorhossen.official5@gmail.com',
      subject: `Your Verification Code: ${generatedOTP}`,
      text: `Your OTP verification code is: ${generatedOTP}`
    });
    console.log(`[TEST-APP] Email sent successfully! MessageId: ${info.messageId}`);
  } catch (err) {
    console.error(`[TEST-APP EMAIL ERROR]:`, err.message);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Verify OTP</title></head>
    <body style="font-family: Arial; padding: 40px; text-align: center;">
      <h2>Enter Verification Code</h2>
      <p>We sent a 6-digit OTP to your email.</p>
      <form action="/verify" method="POST">
        <input type="text" name="otp" id="otp" placeholder="Enter OTP" required style="padding: 10px; width: 250px;"><br><br>
        <button type="submit" id="verify-btn" style="padding: 10px 25px; background: #28a745; color: white; border: none; cursor: pointer;">Verify OTP</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/verify', (req, res) => {
  const { otp } = req.body;
  console.log(`[TEST-APP] Received verification attempt with OTP: ${otp}`);
  if (otp === generatedOTP) {
    console.log(`[TEST-APP] OTP Matched! Account Created!`);
    return res.send(`<h2>Verification Successful! Account Created.</h2>`);
  }
  return res.status(400).send(`<h2>Invalid OTP!</h2>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Test Signup App running on port ${PORT}`);
});
