curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "example@gmail.com",
    "username": "john",
    "password": "securepassword"
  }'

curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "example@gmail.com",
    "password": "securepassword"
  }'

curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "example@gmail.com",
    "otp": "xxxxxx"
  }'
