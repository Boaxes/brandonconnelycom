/**
 * The words in the portfolio book. The pages are laid out by hand in src/book/portfolio.ts (pictures,
 * diagrams and where each section falls); what they say lives here.
 */
const GH = 'https://github.com/Boaxes/';

export const content = {
  fullName: 'Brandon Connely',
  email: 'brandonjconnely@gmail.com',
  github: 'https://github.com/Boaxes',

  about: {
    lead: 'I work across the whole path data takes, from wherever it is first recorded to the table or chart someone makes a decision from.',
    points: [
      {
        title: 'Collect and centralise',
        text: 'I bring data out of the places it accumulates, like older databases and shared drives, with pipelines in dbt and Python, into one normalised Postgres database, and deploy that database to the cloud where a team can rely on it.',
      },
      {
        title: 'Explore and share',
        text: 'Then I analyse it with SQL, Excel and Power BI, or build a small application on top of it, so what it shows is easy for me and my team to get at.',
      },
    ],
    close: 'In practice that makes me part backend developer, part data engineer and part analyst: I can design the database, build what fills it, and answer questions with it.',
  },

  cascadia: {
    org: 'Cascadia Research Collective',
    role: 'Data Engineer / Developer',
    when: 'May – Oct 2026',
    intro: 'Cascadia studies whales, dolphins and other marine mammals, and its surveys produce mostly relational data that needs to be in one place for analysis. I moved it into a new Postgres database, fixing quality issues as I normalised it, and deployed it on DigitalOcean with a web app for working with it.',
    notes: [
      'dbt: a deterministic set of rules, each one written out plainly, corrects species names entered several ways, mistyped coordinates and records that had lost their parent.',
      'Python: scripts to find where the data disagreed with itself. The GPS tracks lived on Google Drive, which an application can\'t work from; they now share one layout in cloud object storage, joined to the database, with tools for adding new and missing tracks.',
      'GitHub: every change is checked, then deployed to the server automatically, so nobody updates it by hand.',
    ],
    appTitle: 'Seeing the data',
    app: 'Much of the data is geographic: where each animal was seen, and the GPS track of every survey. A database can hold that but can\'t show it, so I built a Django application that puts sightings and tracks on a map, filters them by species and lets the team correct what looks wrong. It\'s how location errors get found, and how new data stays clean.',
    people: 'I built it with the researcher whose report it was made for, on that report\'s schedule, and reported to Cascadia\'s head of technology.',
  },

  wwu: {
    org: 'Western Washington University',
    role: 'Research Assistant',
    when: 'June 2025 – April 2026',
    repo: GH + 'Finite-Element-Ion-Channel-Modeling',
    intro: 'A year-long independent study with Professor Zhen Chao, whose research includes mathematical models of ion-channel proteins. We started from the basics of partial differential equations and numerical methods such as finite differences, and worked up to the final goal: solving the Poisson–Boltzmann equation, which describes the electrostatics around an ion channel, with the finite element method in Python.',
    experiments: [
      'A Poisson problem with a known answer, to check the solver and measure how its error falls as the mesh is refined.',
      'A 3D cube, comparing the linearised Poisson–Boltzmann solution with Holst\'s formula for a screened point charge.',
      'Two domains: a low-permittivity molecule in solvent, and how the potential behaves across the boundary between them.',
    ],
    papers: 'Written up in two papers, on the Poisson equation in ion-channel modelling and on the Poisson–Boltzmann experiments.',
    stack: 'Python · FEniCSx · Gmsh · UFL · MPI · NumPy · Matplotlib · PyVista',
  },

  tourism: {
    name: 'Tourism Tax Optimization',
    when: '2025',
    stack: 'Python · NumPy · Matplotlib',
    repo: GH + 'Tourism-Tax-Optimization',
    text: 'For the 2025 Mathematical Contest in Modeling, my team of three had four days to plan sustainable tourism for Juneau, Alaska, where 1.6 million cruise visitors a year bring most of the city\'s spending and much of its strain. We designed a year-by-year simulation: a per-visitor tax, split between infrastructure, community programs and conservation, feeds back into visitor numbers, capacity, revenue and carbon, all judged by one environmental-economic score, E.',
    result: 'A random search over 10,000 policies found the best: a $100 tax, split 65 / 10 / 25. Below, the model itself runs it.',
  },

  tegu: {
    name: 'Invasive Tegu Simulation',
    when: '2025',
    stack: 'Python · Pygame · NumPy · SciPy · graph theory',
    repo: GH + 'Modeling-Invasive-Tegu-Populations',
    text: 'An agent-based model of invasive Argentine black and white tegus spreading through the Florida Everglades, for a paper on graph theory in mathematical biology. The habitat is a graph grown over satellite imagery by random walks drawn toward good ground; every tegu picks its next move by habitat and crowding, ages and breeds, in a real-time viewer I wrote.',
    finding: 'Runs over the same habitat settle into much the same spread, though every graph is random: the population evens out instead of piling up.',
  },

  reptile: {
    name: 'Reptile Central Database',
    stack: 'Python · MySQL · SQLAlchemy · LlamaIndex · GPT-4o mini · Google Cloud Run',
    repo: GH + 'Reptile-Central-Database',
    demo: 'https://reptile-central-328698967588.us-central1.run.app/',
    text: 'A database application for a fictional reptile supplier, built by a team of three: animals, customers, orders and staff in MySQL on Google Cloud SQL, with a Python front end on Cloud Run.',
    ai: 'Its assistant, Reptibot, reads each question and routes it. Questions about the business become SQL, run as a read-only database user so no prompt can change anything; questions about care are answered from the care-sheet manuals by retrieval (RAG).',
    ci: 'Every push runs end-to-end tests against the live database through GitHub Actions.',
  },

  /**
   * Numerical Experiments, the last part of Projects: two to a page, each a taped print beside a short note.
   * The prints are rendered offline by tools/numerical/ into public/portfolio/ (`video` is a looping MP4 with
   * its poster as the still before it loads; `image` a PNG). Nothing here is computed in the browser.
   */
  numericalIntro: 'Six short studies in numerical methods and optimisation, in MATLAB and Python.',
  numerical: [
    {
      name: 'Root-Finding Convergence',
      lang: 'MATLAB',
      repo: GH + 'Root-Finding-Convergence-Analysis',
      text: 'Four methods race to the same root of a quartic, to within a millionth. Newton\'s method gets there in 5 iterations and the secant method in 7; false position needs 50, and fixed-point iteration 97.',
      video: 'ne-roots.mp4', poster: 'ne-roots-poster.jpg',
    },
    {
      name: 'Simplex Scaling',
      lang: 'Python',
      repo: GH + 'Simplex-Scaling-Analysis',
      text: 'How much harder does the simplex method work as a linear program grows? Across 500 random problems, iterations climb steeply with size, and unbounded problems stop far sooner than bounded ones.',
      image: 'ne-simplex.png',
    },
    {
      name: 'Polynomial Interpolation',
      lang: 'MATLAB',
      repo: GH + 'Polynomial-Interpolation-and-Cubic-Splines',
      text: 'A cosine calculator built from nine points. A Newton polynomial through Chebyshev nodes covers a quarter period, and cosine\'s symmetries carry it to every real number, never more than 10⁻⁹ out.',
      video: 'ne-cosine.mp4', poster: 'ne-cosine-poster.jpg',
    },
    {
      name: 'Least Squares Fitting',
      lang: 'MATLAB',
      repo: GH + 'Least-Squares-Curve-Fitting',
      text: 'One model fitted two ways: by the normal equations, and by a QR factorisation built by hand from Householder reflectors. They agree to ten decimal places. Gauss–Newton then fits a nonlinear power law.',
      image: 'ne-least-squares.png',
    },
    {
      name: 'DFP vs Gradient Descent',
      lang: 'Python',
      repo: GH + 'DFP-vs-Gradient-Descent-on-Rosenbrock',
      text: 'Two optimisers in the Rosenbrock function\'s long, curved valley. Gradient descent zigzags between its walls for 33 iterations; DFP, a quasi-Newton method, learns the curvature as it goes and arrives in 14.',
      video: 'ne-dfp.mp4', poster: 'ne-dfp-poster.jpg',
    },
    {
      name: 'Armijo Line Search',
      lang: 'Python',
      repo: GH + 'Armijo-vs-Newton-vs-Golden-Section',
      text: 'How much do a line search\'s two settings matter? Every combination, mapped: a fast basin, slow edges, and 14% that never converge. The default settings take 24 iterations; the best, 6.',
      image: 'ne-armijo.png',
    },
  ] as { name: string; lang: string; repo: string; text: string; video?: string; poster?: string; image?: string }[],
};
