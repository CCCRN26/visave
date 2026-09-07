if(process.env.NODE_ENV!=="development"||process.env.ALLOW_DB_RESET!=="true") throw new Error("Refusing reset: requires NODE_ENV=development and ALLOW_DB_RESET=true");
console.error("Development reset is intentionally not automated. Recreate the development database, then run migrate and seed."); process.exitCode=1;
