const axios = require('axios');

async function simulate() {
  const url = 'http://localhost:3001/webhooks/clerk';
  const payload = {
    data: {
      id: 'user_test_123',
      email_addresses: [{ email_address: 'test@frapp.com' }],
    },
    object: 'event',
    type: 'user.created',
  };

  console.log('Sending simulation request...');
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'svix-id': 'test_id',
        'svix-timestamp': Date.now().toString(),
        'svix-signature': 'test_sig', // Will fail unless guard is disabled
      },
    });
    console.log('Response:', response.data);
  } catch (error) {
    console.error(
      'Error:',
      error.response ? error.response.data : error.message,
    );
    console.log('
Tip: To see this succeed, temporarily comment out the @UseGuards(ClerkWebhookGuard) line in clerk-webhook.controller.ts');
  }
}

simulate();
