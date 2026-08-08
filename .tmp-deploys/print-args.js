const name = process.argv[2];
const j = JSON.parse(require('fs').readFileSync(
  `/home/brandbekras/Dev/u-filldumpsters/.tmp-deploys/${name}.json`,'utf8'));
process.stdout.write(JSON.stringify(j));
