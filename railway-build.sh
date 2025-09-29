#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "--- Cloning Frontend Repositories ---"
# IMPORTANTE: Verifica que estas URLs de repositorios sean correctas.
# Para repositorios privados, necesitarás usar un token de acceso de GitHub.
git clone https://github.com/gongonut/venta_wp_catalogo_frontend.git frontend-repo
git clone https://github.com/gongonut/venta_wp_catalogo_webpage.git webpage-catalog-repo
git clone https://github.com/gongonut/venta_wp_catalogo_update.git wp-catalog-update-repo

echo "--- Building Frontend Applications ---"

# Build frontend
echo "Building: frontend"
cd frontend-repo
npm install
npm run build
cd ..

# Build webpage-catalog
echo "Building: webpage-catalog"
cd webpage-catalog-repo
npm install
npm run build
cd ..

# Build wp-catalog-update
echo "Building: wp-catalog-update"
cd wp-catalog-update-repo
npm install
npm run build
cd ..

echo "--- Preparing 'apps' directory for NestJS ---"
# Esta carpeta ahora está dentro del proyecto backend
rm -rf apps
mkdir -p apps/frontend
mkdir -p apps/webpage-catalog
mkdir -p apps/wp-catalog-update

# Copia los frontends compilados a la carpeta apps
cp -R frontend-repo/dist/frontend/* apps/frontend/
cp -R webpage-catalog-repo/dist/webpage-catalog/* apps/webpage-catalog/
cp -R wp-catalog-update-repo/dist/wp-catalog-update/* apps/wp-catalog-update/

echo "--- Building Backend Application ---"
# Ya estamos en la raíz del repositorio del backend
npm install
npm run build
