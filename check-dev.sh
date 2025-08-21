#!/bin/bash
if pgrep -f "tsx --watch src/index.ts" > /dev/null
then
  echo "✅ npm run dev est en cours d'exécution"
else
  echo "❌ npm run dev est arrêté"
fi