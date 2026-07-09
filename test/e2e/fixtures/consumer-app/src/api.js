// A tiny API client: every function calls a backend HTTP endpoint. These are
// the deterministic "seed" signals the Mocklify scanner keys on (fetch/axios
// calls against /api/... paths).
import axios from 'axios';

const BASE_URL = 'https://api.example.com';

export async function listUsers() {
  const res = await fetch(`${BASE_URL}/api/users`);
  return res.json();
}

export async function getUser(id) {
  const res = await fetch(`${BASE_URL}/api/users/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  if (res.status === 404) {
    throw new Error('User not found');
  }
  return res.json();
}

export async function createUser(payload) {
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteUser(id) {
  await axios.delete(`${BASE_URL}/api/users/${id}`);
}

export async function listOrders() {
  const { data } = await axios.get(`${BASE_URL}/api/orders`, {
    params: { status: 'open' },
  });
  return data;
}

export async function createOrder(order) {
  const { data } = await axios.post(`${BASE_URL}/api/orders`, order);
  return data;
}
