FROM python:3.12-slim

WORKDIR /app

COPY generate_iss_stream.py .

CMD ["python", "generate_iss_stream.py", "--db", "/app/data/satellite.db", "--interval", "3", "--anomaly-rate", "0.15"]
