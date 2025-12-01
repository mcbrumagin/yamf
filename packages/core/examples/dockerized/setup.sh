# Build registry
mkdir -p build/registry
cp registry/index.js build/registry/
cp registry/package.json build/registry/
cp registry/Dockerfile build/registry/
# Copy yamf/core source for registry
mkdir -p build/registry/yamf/core
cp -R ../../src build/registry/yamf/core/
cp ../../package.json build/registry/yamf/core/

# Build services
mkdir -p build/service1
mkdir -p build/service2
mkdir -p build/service3

# Copy service files
cp services/service1.js build/service1/index.js
cp services/service2.js build/service2/index.js
cp services/service3.js build/service3/index.js

# Copy package.json with local dependency
cp services/service-package.json build/service1/package.json
cp services/service-package.json build/service2/package.json
cp services/service-package.json build/service3/package.json

# Copy yamf/core source for each service
mkdir -p build/service1/yamf/core
mkdir -p build/service2/yamf/core
mkdir -p build/service3/yamf/core

cp -R ../../src build/service1/yamf/core/
cp ../../package.json build/service1/yamf/core/

cp -R ../../src build/service2/yamf/core/
cp ../../package.json build/service2/yamf/core/

cp -R ../../src build/service3/yamf/core/
cp ../../package.json build/service3/yamf/core/

# Copy Dockerfile
cp services/Dockerfile build/service1/Dockerfile
cp services/Dockerfile build/service2/Dockerfile
cp services/Dockerfile build/service3/Dockerfile
