// A React-ish component that renders data fetched from the API client. Present
// so the fixture looks like a real front-end app, not just an API-call dump.
import React, { useEffect, useState } from 'react';
import { listUsers, createUser } from './api.js';

export function App() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    listUsers().then(setUsers);
  }, []);

  const onAdd = async () => {
    const created = await createUser({ name: 'New User', email: 'new@example.com' });
    setUsers((prev) => [...prev, created]);
  };

  return React.createElement(
    'div',
    null,
    React.createElement('button', { onClick: onAdd }, 'Add user'),
    users.map((u) => React.createElement('li', { key: u.id }, u.name))
  );
}
