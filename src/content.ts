/**
 * Portfolio content. Edit this file — nothing in the 3D scene depends on it.
 * Everything below is placeholder text; swap in the real thing.
 */
export const content = {
  name: 'Brandon',
  title: 'Data Engineer',
  tagline: 'I build the pipelines, models and dashboards that turn messy operational data into something a team can trust.',
  location: 'Seattle, WA',
  email: 'hello@example.com',
  links: {
    github: 'https://github.com/',
    linkedin: 'https://www.linkedin.com/',
    resume: '/resume.pdf',
  },
  about: [
    'Data engineer with a background in analytics. I care about the unglamorous middle of the stack: schema design, idempotent pipelines, tests that catch bad data before a dashboard does.',
    'Most of my work has been in Python and SQL on top of warehouses like BigQuery and Snowflake, with dbt for modelling and Airflow or Dagster for orchestration. I like Rust and Go for the parts that need to be fast.',
    'When I am not working I am usually near, on, or in the water somewhere on the Salish Sea, which is why this site looks the way it does.',
  ],
  projects: [
    {
      name: 'Vessel telemetry lakehouse',
      meta: '2025 · Python · dbt · BigQuery · Dagster',
      blurb: 'Ingested AIS and engine telemetry from a small fleet into a partitioned lakehouse, with dbt models for fuel burn, idle time and route efficiency. Cut a 6-hour nightly job to 18 minutes with incremental models.',
      link: '#',
      tags: ['streaming', 'dbt', 'incremental models', 'data quality'],
    },
    {
      name: 'Warehouse cost observability',
      meta: '2024 · SQL · Snowflake · Grafana',
      blurb: 'Built query-level cost attribution for a shared Snowflake account. Surfaced the 4% of queries responsible for 60% of credits and worked with teams to fix them; ~35% monthly spend reduction.',
      link: '#',
      tags: ['finops', 'observability', 'snowflake'],
    },
    {
      name: 'Tide & current forecast API',
      meta: '2024 · Rust · Postgres · NOAA data',
      blurb: 'A small service that harmonises NOAA tide predictions and current stations for the Puget Sound into one clean API, with a nightly backfill and validation against observed levels.',
      link: '#',
      tags: ['rust', 'api', 'geospatial'],
    },
    {
      name: 'Event schema registry & contracts',
      meta: '2023 · Python · Kafka · Avro',
      blurb: 'Introduced schema contracts between product engineering and analytics. Breaking changes now fail in CI instead of at 3am in a pipeline.',
      link: '#',
      tags: ['data contracts', 'kafka', 'ci'],
    },
  ],
  experience: [
    { when: '2023 – now', role: 'Data Engineer', org: 'Placeholder Co.', blurb: 'Owner of the analytics platform: ingestion, modelling, orchestration and the on-call rotation that keeps it honest.' },
    { when: '2021 – 2023', role: 'Analytics Engineer', org: 'Another Placeholder', blurb: 'Moved reporting from spreadsheets and ad-hoc SQL onto dbt with tests and documentation. Trained analysts on the modelling layer.' },
    { when: '2019 – 2021', role: 'Data Analyst', org: 'First Placeholder', blurb: 'Dashboards, experiments and a great deal of SQL.' },
  ],
  skills: {
    'Languages': ['Python', 'SQL', 'Rust', 'Go', 'TypeScript'],
    'Warehouses & storage': ['BigQuery', 'Snowflake', 'Postgres', 'DuckDB', 'Parquet / Iceberg'],
    'Pipelines': ['dbt', 'Dagster', 'Airflow', 'Kafka', 'Spark'],
    'Infra & tooling': ['Terraform', 'Docker', 'GitHub Actions', 'Grafana', 'GCP / AWS'],
  },
};
