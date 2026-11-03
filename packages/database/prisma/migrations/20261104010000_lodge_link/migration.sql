-- CreateEnum
CREATE TYPE "LinkCommandStatus" AS ENUM ('PENDING', 'SENT', 'DONE', 'FAILED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "GatewayVendor" ADD VALUE 'OMADA';

-- CreateTable
CREATE TABLE "lodge_links" (
    "id" UUID NOT NULL,
    "gatewayId" UUID NOT NULL,
    "pairingCodeHash" VARCHAR(64),
    "pairingExpiresAt" TIMESTAMPTZ(3),
    "tokenHash" VARCHAR(64),
    "pairedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),
    "agentVersion" VARCHAR(40),
    "controllerVersion" VARCHAR(40),
    "controllerOk" BOOLEAN NOT NULL DEFAULT false,
    "detail" VARCHAR(200),
    "features" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lodge_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_commands" (
    "id" UUID NOT NULL,
    "gatewayId" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "LinkCommandStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "doneAt" TIMESTAMPTZ(3),

    CONSTRAINT "link_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_clients" (
    "id" UUID NOT NULL,
    "gatewayId" UUID NOT NULL,
    "macAddress" VARCHAR(17) NOT NULL,
    "apMac" VARCHAR(17) NOT NULL,
    "ssidName" VARCHAR(64) NOT NULL,
    "radioId" INTEGER NOT NULL,
    "site" VARCHAR(64) NOT NULL,
    "seenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_grants" (
    "entitlementId" UUID NOT NULL,
    "gatewayId" UUID NOT NULL,
    "state" VARCHAR(12) NOT NULL,
    "devices" VARCHAR(17)[],
    "expiresAt" TIMESTAMPTZ(3),
    "maxSessions" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "link_grants_pkey" PRIMARY KEY ("entitlementId")
);

-- CreateIndex
CREATE UNIQUE INDEX "lodge_links_gatewayId_key" ON "lodge_links"("gatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "lodge_links_tokenHash_key" ON "lodge_links"("tokenHash");

-- CreateIndex
CREATE INDEX "link_commands_gatewayId_status_createdAt_idx" ON "link_commands"("gatewayId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "portal_clients_gatewayId_macAddress_key" ON "portal_clients"("gatewayId", "macAddress");

-- CreateIndex
CREATE INDEX "link_grants_gatewayId_idx" ON "link_grants"("gatewayId");

-- AddForeignKey
ALTER TABLE "lodge_links" ADD CONSTRAINT "lodge_links_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_commands" ADD CONSTRAINT "link_commands_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_clients" ADD CONSTRAINT "portal_clients_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_grants" ADD CONSTRAINT "link_grants_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

