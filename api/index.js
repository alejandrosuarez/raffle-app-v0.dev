require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs').promises;
const { EventEmitter } = require('events');

const app = express();
const port = process.env.PORT || 3000;
const dataEmitter = new EventEmitter();

// Supabase client initialization
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL or Anon Key is missing. Please check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

app.use(express.json());
app.use(express.static('public'));

// Helper function to fetch numbers
async function fetchNumbers() {
  const { data, error } = await supabase
    .from('numbers')
    .select('*')
    .order('number');
  if (error) throw error;
  return data;
}

// Main route to serve the index.html with injected data
// Main route to serve the index.html with injected data
app.get('/', async (req, res) => {
  try {
    const numbers = await fetchNumbers();
    const htmlPath = path.join(__dirname, '../public/index.html');
    let html = await fs.readFile(htmlPath, 'utf-8');
    
    // Inject the numbers data into the HTML
    html = html.replace(
      '<script>const initialData = __INITIAL_DATA__;</script>',
      `<script>const initialData = ${JSON.stringify(numbers)};</script>`
    );
    
    res.send(html);
  } catch (error) {
    console.error('Error serving index.html:', error);
    res.status(500).send('An error occurred while loading the page');
  }
});

// API Routes
app.get('/api/numbers', async (req, res) => {
  try {
    const numbers = await fetchNumbers();
    res.json(numbers);
  } catch (error) {
    console.error('Error fetching numbers:', error);
    res.status(500).json({ error: 'An error occurred while fetching numbers' });
  }
});

app.post('/api/reserve', async (req, res) => {
  try {
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

    if (error) throw error;
    res.json(data);

    // Emit update event
    const updatedNumbers = await fetchNumbers();
    dataEmitter.emit('update', updatedNumbers);
  } catch (error) {
    console.error('Error reserving numbers:', error);
    res.status(500).json({ error: 'An error occurred while reserving numbers' });
  }
});

app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { numbers } = req.body;

    const { data, error } = await supabase
      .from('numbers')
      .update({ status: 'sold' })
      .in('number', numbers)
      .select();

    if (error) throw error;
    res.json(data);

    // Emit update event
    const updatedNumbers = await fetchNumbers();
    dataEmitter.emit('update', updatedNumbers);
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ error: 'An error occurred while confirming payment' });
  }
});

// Server-Sent Events endpoint
app.get('/api/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  dataEmitter.on('update', sendEvent);

  req.on('close', () => {
    dataEmitter.off('update', sendEvent);
  });
});

// Periodic task to check expired reservations
setInterval(async () => {
  try {
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

    if (error) throw error;

    // Emit update event after clearing expired reservations
    const updatedNumbers = await fetchNumbers();
    dataEmitter.emit('update', updatedNumbers);
  } catch (error) {
    console.error('Error updating expired reservations:', error);
  }
}, 60000);

// Supabase real-time subscription
supabase
  .channel('public:numbers')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'numbers' }, async () => {
    const numbers = await fetchNumbers();
    dataEmitter.emit('update', numbers);
  })
  .subscribe();

// Server startup
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

module.exports = app;