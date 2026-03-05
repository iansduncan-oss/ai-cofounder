#!/bin/bash
cd /opt/ai-cofounder
docker compose -f docker-compose.monitoring.yml restart alertmanager
