# Catalog Service

ECI Catalog microservice providing product CRUD, search, and authoritative pricing resolution.

## Features
- Versioned API: `/v1/products`
- Product CRUD and soft delete
- Search/filtering/pagination
- Pricing resolution endpoint for Order service
- Standard error format: `code`, `message`, `correlationId`
- OpenAPI docs at `/docs`
- Metrics at `/metrics`

## Quick Start

### Option 1: Local Development (No Docker)
1. Ensure PostgreSQL is running and `catalog_db` exists.
2. Create `.env` from `.env.example`.
3. Run:
   ```bash
   npm install
   npm start
   ```
4. Service runs on `http://localhost:3001`

### Option 2: Docker (Single Service)
1. Build the Docker image:
   ```bash
   docker build -t eci-catalog-service:latest .
   ```
2. Create Docker network (if not exists):
   ```bash
   docker network create eci-net
   ```
3. Run PostgreSQL container:
   ```bash
   docker run -d --name catalog-db --network eci-net \
     -e POSTGRES_USER=user \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=catalog_db \
     -p 5431:5432 \
     postgres:16-alpine
   ```
4. Run the service container:
   ```bash
   docker run -d --name catalog-service --network eci-net \
     -e DATABASE_URL=postgres://user:password@catalog-db:5432/catalog_db \
     -e APP_PORT=3001 \
     -p 3001:3001 \
     eci-catalog-service:latest
   ```
5. Verify running:
   ```bash
   curl http://localhost:3001/health
   ```

### Option 3: Docker Compose (Full Stack - from root directory)
From the `FullApplication/` root directory:
```bash
# Build all services and start the stack
docker compose -f docker-compose.yml up --build -d

# View logs
docker compose -f docker-compose.yml logs -f catalog-service

# Stop all services
docker compose -f docker-compose.yml down
```

### Seeding (PowerShell)
Run from the `FullApplication/` root directory:
```powershell
# Seed only catalog service
docker compose -f docker-compose.yml exec catalog-service npm run seed
```

## Important Endpoints
- `GET /health` — Health check
- `POST /v1/products` — Create product
- `GET /v1/products?page=1&limit=10&q=shoe` — List products with search
- `PATCH /v1/products/{productId}` — Update product
- `DELETE /v1/products/{productId}` — Delete product (soft delete)
- `POST /v1/products/pricing/resolve` — Resolve pricing for Order service
- `GET /docs` — OpenAPI Swagger UI
- `GET /metrics` — Prometheus metrics

## Kubernetes Deployment (Minikube)

### Prerequisites
- Minikube running: `minikube start`
- kubectl configured
- Image available in Minikube

### Deployment Steps

1. **Build image for Minikube** (use Minikube's Docker daemon):
   ```bash
   # Set eval for Minikube Docker environment
   eval $(minikube docker-env)
   
   # Build the image
   docker build -t eci-catalog-service:latest .
   ```

2. **Apply Kubernetes manifests** (from service root):
   ```bash
   # Create config map
   kubectl apply -f k8s/catalog-config.yaml
   
   # Create database (PVC + StatefulSet)
   kubectl apply -f k8s/catalog-db.yaml
   
   # Wait for DB to be ready (~30s)
   kubectl rollout status statefulset/catalog-db
   
   # Create service + deployment
   kubectl apply -f k8s/catalog-service.yaml
   
   # Wait for deployment
   kubectl rollout status deployment/catalog-service
   ```

3. **Verify deployment**:
   ```bash
   # Check pods
   kubectl get pods -l app=catalog-service
   
   # Check service
   kubectl get svc catalog-service
   
   # View logs
   kubectl logs -l app=catalog-service -f
   ```

4. **Access the service** (port-forward):
   ```bash
   # Forward port 3001 to localhost
   kubectl port-forward svc/catalog-service 3001:3001
   
   # Test health endpoint
   curl http://localhost:3001/health
   
   # Access Swagger UI
   # Open browser: http://localhost:3001/docs
   ```

5. **Cleanup**:
   ```bash
   kubectl delete -f k8s/catalog-service.yaml
   kubectl delete -f k8s/catalog-db.yaml
   kubectl delete -f k8s/catalog-config.yaml
   ```
