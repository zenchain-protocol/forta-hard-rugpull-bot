import axios from 'axios';
import { fetchJwt } from '@fortanetwork/forta-bot'

// Function to get value from the /value endpoint
export async function getValue(key) {
  const headers = {
    'Content-type': 'application/json',
    'Accept': 'application/json'
  };
  if (process.env.NODE_ENV === "production") {
    const token = await fetchJwt({key: "value"}, new Date(Date.now() + 5000 /* 5 seconds */))
    headers['Authorization'] = `Bearer ${token}`
  }
  const response = await axios.get(`${process.env.KEYS_API_BASE_URL}/value`, {
    params: {
      key: key
    },
    headers: headers
  });
  return response.data.data;
}
