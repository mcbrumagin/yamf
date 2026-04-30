export YAMF_GATEWAY_URL=http://localhost:11000 # publicly accessible
export YAMF_REGISTRY_URL=http://localhost:11001 # primary internal port

export ENVIRONMENT=dev
export ADMIN_USER=admin
export ADMIN_PASS=password

export LOG_LEVEL=info
export LOG_INCLUDE_LINES=true
export LOG_EXCLUDE_FULL_PATH_IN_LOG_LINES=true

yamf run bootstrap.js
