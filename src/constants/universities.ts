export interface University {
  id: string;
  name: string;
  campuses: string[];
}

export const NIGERIAN_UNIVERSITIES: University[] = [
  {
    id: 'abu',
    name: 'Ahmadu Bello University',
    campuses: [
      'Samaru Campus (Main)', 
      'Kongo Campus', 
      'Shika Campus'
    ]
  },
  {
    id: 'uniben',
    name: 'University of Benin',
    campuses: [
      'Ugbowo Campus (Main)', 
      'Ekenwan Campus'
    ]
  },
  {
    id: 'unilag',
    name: 'University of Lagos',
    campuses: [
      'Akoka Campus (Main)', 
      'Yaba Campus', 
      'Idi-Araba Campus (CMUL)'
    ]
  },
  {
    id: 'unn',
    name: 'University of Nigeria, Nsukka',
    campuses: [
      'Nsukka Campus (Main)', 
      'Enugu Campus (UNEC)', 
      'Ituku-Ozalla Campus (UNTH)', 
      'Aba Campus'
    ]
  },
  {
    id: 'buk',
    name: 'Bayero University Kano',
    campuses: [
      'New Campus (Main)', 
      'Old Campus', 
      'Aminu Kano Teaching Hospital (AKTH)'
    ]
  }
];