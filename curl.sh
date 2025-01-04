curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "example@example.com",
    "username": "john",
    "password": "securepassword"
  }'
