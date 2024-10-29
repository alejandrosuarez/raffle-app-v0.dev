const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

// Supabase client initialization
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.json());
app.use(express.static('public'));

// Fetch all numbers
app.get('/api/numbers', async (req, res) => {
  const { data, error } = await supabase
    .from('numbers')
    .select('*')
    .order('number');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Reserve numbers
app.post('/api/reserve', async (req, res) => {
  const { numbers, name, email, phone } = req.body;
  const reservationExpiry = new Date(Date.now() + 15 * 60 * 1000);

  const { data, error } = await supabase
    .from('numbers')
    .upsert(numbers.map(number => ({
      number,
      status: 'reserved',
      name,
      email,
      phone,
      reservation_date: new Date(),
      reservation_expiry: reservationExpiry
    })))
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Confirm payment
app.post('/api/confirm-payment', async (req, res) => {
  const { numbers } = req.body;

  const { data, error } = await supabase
    .from('numbers')
    .update({ status: 'sold' })
    .in('number', numbers)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Check expired reservations
setInterval(async () => {
  const { error } = await supabase
    .from('numbers')
    .update({
      status: 'available',
      name: null,
      email: null,
      phone: null,
      reservation_date: null,
      reservation_expiry: null
    })
    .eq('status', 'reserved')
    .lt('reservation_expiry', new Date().toISOString());

  if (error) console.error('Error updating expired reservations:', error);
}, 60000);

module.exports = app;