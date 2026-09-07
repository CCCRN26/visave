CREATE TABLE roles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE permissions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(80) NOT NULL UNIQUE, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE role_permissions (role_id UUID NOT NULL REFERENCES roles(id), permission_id UUID NOT NULL REFERENCES permissions(id), PRIMARY KEY(role_id,permission_id));
