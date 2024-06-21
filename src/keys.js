import axios from 'axios';

// Function to get value from the /value endpoint
export async function getValue(key) {
  const response = await axios.get(`${process.env.KEYS_API_BASE_URL}/value`, {
    params: {
      key: key
    }
  });
  return response.data;
}
