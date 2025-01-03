#!/bin/bash
docker compose down
docker rmi -f $(docker images -qa)
docker volume rm -f $(docker volume ls -q)
docker system prune -f
docker system df
